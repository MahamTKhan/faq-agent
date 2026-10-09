import { db } from "@/lib/db";
import { appName, handle, HttpError, isEmail, isUuid, json, readJson, requireAdmin, str } from "@/lib/http";
import { createDocument } from "@/lib/kb";
import { emailHtml, sendMail } from "@/lib/mail";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ qid: string }> };

/**
 * actions:
 *  - "answer":  { reply, sendEmail, addToKb, email? } → posts the reply in the client's chat,
 *               optionally emails it to them and saves the Q&A to the knowledge base.
 *  - "dismiss" / "reopen"
 *  - "update":  { email } → just saves the client's email address.
 */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { qid } = await ctx.params;
  if (!isUuid(qid)) throw new HttpError(404, "Question not found.");
  const body = await readJson(req);
  const sql = await db();
  const [q] = await sql`
    SELECT q.*, p.name AS project_name, p.slug, p.notify_email
    FROM questions q JOIN projects p ON p.id = q.project_id WHERE q.id = ${qid}`;
  if (!q) throw new HttpError(404, "Question not found.");

  const action = str(body.action, 20);
  const email = typeof body.email === "string" ? str(body.email, 300).trim() : q.visitor_email;
  if (email && !isEmail(email)) throw new HttpError(400, "That email address doesn't look right.");

  if (action === "update") {
    await sql`UPDATE questions SET visitor_email = ${email} WHERE id = ${qid}`;
    return json({ ok: true });
  }
  if (action === "dismiss" || action === "reopen") {
    await sql`UPDATE questions SET status = ${action === "dismiss" ? "dismissed" : "open"} WHERE id = ${qid}`;
    return json({ ok: true });
  }
  if (action !== "answer") throw new HttpError(400, "Unknown action.");

  const reply = str(body.reply, 20_000).trim();
  if (!reply) throw new HttpError(400, "Write a reply first.");
  if (/\[CONFIRM:/i.test(reply)) throw new HttpError(400, "The reply still has [CONFIRM: …] placeholders. Check and remove them before sending.");

  let emailed = false;
  if (body.sendEmail === true) {
    if (!email) throw new HttpError(400, "Add the client's email address first, or untick “Email it”.");
    const result = await sendMail({
      to: email,
      replyTo: q.notify_email || process.env.ADMIN_EMAIL,
      subject: `Re: your question about ${q.project_name}`,
      text: `You asked:\n${q.question}\n\nOur answer:\n${reply}\n`,
      html: emailHtml({
        heading: `Answer to your question about ${q.project_name}`,
        blocks: [
          { label: "You asked", body: q.question, tone: "muted" },
          { label: "Our answer", body: reply, tone: "highlight" },
        ],
        footer: `You can reply to this email if anything is unclear.`,
      }),
    });
    if (!result.sent) throw new HttpError(500, `Couldn't email the client: ${result.reason}. Untick “Email it” to post the reply in the chat only.`);
    emailed = true;
  }

  if (q.conversation_id) {
    await sql`INSERT INTO messages (conversation_id, role, content, status) VALUES (${q.conversation_id}, 'team', ${reply}, 'team_reply')`;
    await sql`UPDATE conversations SET last_message_at = now() WHERE id = ${q.conversation_id}`;
  }

  let docId: string | null = null;
  if (body.addToKb === true) {
    const question = str(body.question, 2000).trim() || q.question;
    docId = await createDocument(sql, q.project_id, {
      title: `Q&A: ${question.replace(/\s+/g, " ").slice(0, 90)}`,
      kind: "faq",
      content: `Question: ${question}\n\nAnswer (confirmed by the project team on ${new Date().toISOString().slice(0, 10)}):\n${reply}`,
      sourceName: `${appName()} – answered question`,
    });
  }

  await sql`
    UPDATE questions SET status = 'answered', final_reply = ${reply}, visitor_email = ${email}, answered_at = now()
    WHERE id = ${qid}`;
  return json({ ok: true, emailed, docId });
});

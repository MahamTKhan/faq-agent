import { db } from "@/lib/db";
import { appUrl, clientIp, handle, HttpError, isEmail, isUuid, json, rateLimit, readJson, str } from "@/lib/http";
import { emailHtml, sendMail } from "@/lib/mail";
import { checkAccessCode, notifyAddress, projectBySlug } from "@/lib/project";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

/** The client leaves their name/email so the team can reply to a forwarded question. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const sql = await db();
  const project = await projectBySlug(sql, slug);
  checkAccessCode(project, req);
  await rateLimit(sql, `contact:${project.id}:${clientIp(req)}`, 10, 10 * 60);

  const body = await readJson(req);
  const cid = str(body.conversationId, 100);
  const name = str(body.name, 200).trim();
  const email = str(body.email, 300).trim();
  if (!isUuid(cid)) throw new HttpError(400, "Conversation not found.");
  if (!isEmail(email)) throw new HttpError(400, "Please enter a valid email address.");

  const [conv] = await sql`
    UPDATE conversations SET visitor_email = ${email}, visitor_name = COALESCE(NULLIF(${name}, ''), visitor_name)
    WHERE id = ${cid} AND project_id = ${project.id} RETURNING id`;
  if (!conv) throw new HttpError(404, "Conversation not found.");

  const updated = await sql<{ id: string; question: string }[]>`
    UPDATE questions SET visitor_email = ${email}
    WHERE conversation_id = ${cid} AND status = 'open' AND visitor_email = ''
    RETURNING id, question`;

  if (updated.length) {
    const link = `${appUrl(req)}/admin/projects/${project.id}?q=${updated[0].id}`;
    try {
      await sendMail({
        to: notifyAddress(project),
        replyTo: email,
        subject: `[${project.name}] ${name || email} left their email for a question`,
        text: `${name ? name + " " : ""}<${email}> left their email so you can reply to:\n\n${updated.map((u) => `• ${u.question}`).join("\n")}\n\nAnswer here: ${link}\n`,
        html: emailHtml({
          heading: `Contact details added on ${project.name}`,
          blocks: [
            { label: "From", body: `${name ? name + " " : ""}<${email}>` },
            { label: updated.length > 1 ? "Their open questions" : "Their question", body: updated.map((u) => `• ${u.question}`).join("\n"), tone: "muted" },
          ],
          button: { href: link, text: "Review and answer" },
        }),
      });
    } catch (e) {
      console.error("Contact email failed", e);
    }
  }
  return json({ ok: true });
});

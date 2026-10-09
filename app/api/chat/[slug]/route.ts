import { answerQuestion, type BotResult, type ChatTurn } from "@/lib/claude";
import { db } from "@/lib/db";
import { appName, appUrl, clientIp, handle, HttpError, isEmail, isUuid, json, rateLimit, readJson, str } from "@/lib/http";
import { buildKnowledge } from "@/lib/kb";
import { emailHtml, sendMail } from "@/lib/mail";
import { checkAccessCode, notifyAddress, projectBySlug } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ slug: string }> };

type MsgRow = { id: string; role: string; content: string; status: string; sources: string[]; created_at: Date };

/** Loads a conversation's messages (the client reopening the page sees team replies here). */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const sql = await db();
  const project = await projectBySlug(sql, slug);
  checkAccessCode(project, req);
  const cid = new URL(req.url).searchParams.get("c") || "";
  if (!isUuid(cid)) return json({ messages: [], conversation: null });
  const [conv] = await sql`SELECT id, visitor_name, visitor_email FROM conversations WHERE id = ${cid} AND project_id = ${project.id}`;
  if (!conv) return json({ messages: [], conversation: null });
  const messages = await sql<MsgRow[]>`
    SELECT id::text, role, content, status, sources, created_at FROM messages WHERE conversation_id = ${cid} ORDER BY id`;
  return json({ messages, conversation: conv });
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const sql = await db();
  const project = await projectBySlug(sql, slug);
  checkAccessCode(project, req);
  await rateLimit(sql, `chat:${project.id}:${clientIp(req)}`, 40, 10 * 60, "You're sending messages very quickly. Please wait a few minutes.");

  const body = await readJson(req);
  const message = str(body.message, 4000).trim();
  if (!message) throw new HttpError(400, "Type a question first.");
  const name = str(body.name, 200).trim();
  const email = str(body.email, 300).trim();

  // Find or start the conversation.
  let cid = str(body.conversationId, 100);
  let conv: { id: string; visitor_name: string; visitor_email: string } | undefined;
  if (isUuid(cid)) {
    [conv] = await sql`SELECT id, visitor_name, visitor_email FROM conversations WHERE id = ${cid} AND project_id = ${project.id}`;
  }
  if (!conv) {
    [conv] = await sql`
      INSERT INTO conversations (project_id, visitor_name, visitor_email)
      VALUES (${project.id}, ${name}, ${isEmail(email) ? email : ""})
      RETURNING id, visitor_name, visitor_email`;
  } else if ((name && !conv.visitor_name) || (isEmail(email) && !conv.visitor_email)) {
    [conv] = await sql`
      UPDATE conversations SET visitor_name = COALESCE(NULLIF(visitor_name, ''), ${name}),
        visitor_email = COALESCE(NULLIF(visitor_email, ''), ${isEmail(email) ? email : ""})
      WHERE id = ${conv.id} RETURNING id, visitor_name, visitor_email`;
  }
  cid = conv!.id;

  await sql`INSERT INTO messages (conversation_id, role, content) VALUES (${cid}, 'user', ${message})`;
  await sql`UPDATE conversations SET last_message_at = now() WHERE id = ${cid}`;

  // Recent history, shaped into alternating user/assistant turns.
  const recent = await sql<MsgRow[]>`
    SELECT id::text, role, content, status, sources, created_at FROM messages
    WHERE conversation_id = ${cid} ORDER BY id DESC LIMIT 14`;
  const history: ChatTurn[] = [];
  for (const m of recent.reverse()) {
    const role = m.role === "user" ? "user" : "assistant";
    const content = m.role === "team" ? `[Reply from the project team]\n${m.content}` : m.content;
    const last = history[history.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else history.push({ role, content });
  }
  while (history.length && history[0].role !== "user") history.shift();

  let result: BotResult;
  let failed = false;
  try {
    const kb = await buildKnowledge(sql, project.id, history.filter((h) => h.role === "user").slice(-2).map((h) => h.content).join("\n"));
    result = await answerQuestion({ project: { name: project.name, client: project.client_name }, knowledge: kb.text, history });
  } catch (e) {
    console.error("answerQuestion failed", e);
    failed = true;
    result = {
      status: "escalate",
      answer: "I couldn't look this up right now, so I've passed your question to the project team. They'll get back to you.",
      sources: [],
      suggested_reply: "",
      admin_note: `The assistant failed to answer: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const status = result.status === "escalate" ? "escalated" : "answered";
  const [saved] = await sql<MsgRow[]>`
    INSERT INTO messages (conversation_id, role, content, status, sources)
    VALUES (${cid}, 'assistant', ${result.answer}, ${status}, ${sql.json(result.sources)})
    RETURNING id::text, role, content, status, sources, created_at`;

  if (result.status === "escalate") {
    const [q] = await sql<{ id: string }[]>`
      INSERT INTO questions (project_id, conversation_id, question, bot_reply, suggested_reply, admin_note, visitor_email)
      VALUES (${project.id}, ${cid}, ${message}, ${result.answer}, ${result.suggested_reply}, ${result.admin_note}, ${conv!.visitor_email})
      RETURNING id`;
    const to = notifyAddress(project);
    const link = `${appUrl(req)}/admin/projects/${project.id}?q=${q.id}`;
    const who = conv!.visitor_email ? `${conv!.visitor_name ? conv!.visitor_name + " " : ""}<${conv!.visitor_email}>` : "Not given yet";
    try {
      await sendMail({
        to,
        replyTo: conv!.visitor_email || undefined,
        subject: `[${project.name}] New question needs your answer`,
        text:
          `New question on ${project.name}${project.client_name ? ` (${project.client_name})` : ""}\n\n` +
          `Question:\n${message}\n\nFrom: ${who}\n\nWhat the assistant told them:\n${result.answer}\n\n` +
          (result.suggested_reply ? `Suggested reply:\n${result.suggested_reply}\n\n` : "") +
          (result.admin_note ? `Note: ${result.admin_note}\n\n` : "") +
          `Answer it here (it's added to the knowledge base): ${link}\n`,
        html: emailHtml({
          heading: `New question on ${project.name}`,
          blocks: [
            { label: "Question", body: message, tone: "muted" },
            { label: "From", body: who },
            ...(result.suggested_reply ? [{ label: "Suggested reply", body: result.suggested_reply, tone: "highlight" as const }] : []),
            ...(result.admin_note ? [{ label: "What's missing", body: result.admin_note }] : []),
            { label: "What the assistant told them", body: result.answer },
          ],
          button: { href: link, text: "Review and answer" },
          footer: `Answering from ${appName()} posts your reply in their chat, can email it to them, and adds it to the knowledge base so the assistant can answer it next time.${failed ? "\n\nThe assistant hit an error on this question — check your Anthropic API key and credit." : ""}`,
        }),
      });
    } catch (e) {
      console.error("Escalation email failed", e);
    }
  }

  return json({
    conversationId: cid,
    message: saved,
    needsEmail: result.status === "escalate" && !conv!.visitor_email,
  });
});

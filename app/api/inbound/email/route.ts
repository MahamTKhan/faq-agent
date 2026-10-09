import { after } from "next/server";
import { safeEqual } from "@/lib/auth";
import { db } from "@/lib/db";
import { extractText, htmlToMarkdown, titleFromFilename } from "@/lib/extract";
import { handle, HttpError, json, readJson } from "@/lib/http";
import { projectKeyOf, readPdfServer, senderAllowed, type InboundEmail } from "@/lib/inbound";
import { createDocument } from "@/lib/kb";
import { extractActionItems } from "@/lib/tracker";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Postmark inbound webhook. Set the webhook URL in Postmark to
 *   https://<your-app>/api/inbound/email?secret=<INBOUND_SECRET>
 * Each project's forwarding address is <your-inbound-address>+<project key>@inbound.postmarkapp.com.
 */
export const POST = handle(async (req: Request) => {
  const secret = process.env.INBOUND_SECRET || "";
  if (secret.length < 12) throw new HttpError(503, "Email forwarding isn't set up (INBOUND_SECRET missing).");
  const given = new URL(req.url).searchParams.get("secret") || "";
  if (!safeEqual(given, secret)) throw new HttpError(401, "Wrong secret.");

  const m = await readJson<InboundEmail>(req);
  const sql = await db();
  const key = projectKeyOf(m);
  // Always answer 200 for mail we deliberately ignore, so Postmark doesn't keep retrying it.
  if (!key) return json({ ok: true, ignored: "no project key in the address" });
  const [project] = await sql<{ id: string; name: string }[]>`SELECT id, name FROM projects WHERE inbound_key = ${key}`;
  if (!project) return json({ ok: true, ignored: "unknown project" });
  const from = (m.FromFull?.Email || m.From || "").trim();
  if (!(await senderAllowed(sql, from))) return json({ ok: true, ignored: "sender not allowed" });

  const subject = (m.Subject || "Forwarded email").trim().slice(0, 280);
  const body = (m.TextBody || "").trim() || (m.HtmlBody ? htmlToMarkdown(m.HtmlBody) : "");
  const notes: string[] = [];

  // Attachments: text-like files are read now; PDFs are read in the background.
  const pdfs: { name: string; buf: Buffer }[] = [];
  const attachmentDocs: string[] = [];
  for (const a of m.Attachments || []) {
    const name = a.Name || "attachment";
    const type = (a.ContentType || "").toLowerCase();
    if (!a.Content || type.startsWith("image/")) continue;
    const buf = Buffer.from(a.Content, "base64");
    if (type === "application/pdf" || /\.pdf$/i.test(name)) {
      pdfs.push({ name, buf });
      continue;
    }
    try {
      const { text, kind } = await extractText(new File([new Uint8Array(buf)], name, { type }));
      if (text.trim()) {
        attachmentDocs.push(
          await createDocument(sql, project.id, { title: titleFromFilename(name), kind, content: text.slice(0, 2_000_000), sourceName: `${name} (attached to "${subject}")` }),
        );
      }
    } catch {
      notes.push(`[Attachment "${name}" couldn't be read. Upload it in the Knowledge base tab if it matters.]`);
    }
  }

  const header = [`Subject: ${subject}`, `Forwarded by: ${m.FromName ? `${m.FromName} <${from}>` : from}`, m.Date ? `Date: ${m.Date}` : ""]
    .filter(Boolean)
    .join("\n");
  const emailDocId = await createDocument(sql, project.id, {
    title: subject,
    kind: "email",
    content: `${header}\n\n${body}${notes.length ? `\n\n${notes.join("\n")}` : ""}`.slice(0, 2_000_000),
    sourceName: `Forwarded email from ${from}`,
  });

  after(async () => {
    const s = await db();
    for (const pdf of pdfs) {
      try {
        const out = await readPdfServer(pdf.buf, pdf.name);
        if (!out) {
          await createDocument(s, project.id, {
            title: `${titleFromFilename(pdf.name)} (not imported)`,
            kind: "note",
            content: `The PDF "${pdf.name}" attached to "${subject}" has more than 40 pages, so it wasn't imported automatically. Upload it in the Knowledge base tab.`,
          });
          continue;
        }
        await createDocument(s, project.id, { title: titleFromFilename(pdf.name), kind: "document", content: out.text, sourceName: `${pdf.name} (attached to "${subject}")` });
      } catch (e) {
        console.error("PDF attachment failed", pdf.name, e);
      }
    }
    try {
      await extractActionItems(s, emailDocId);
    } catch (e) {
      console.error("Action item extraction failed", e);
    }
  });

  return json({ ok: true, documentId: emailDocId, attachments: attachmentDocs.length, pdfs: pdfs.length });
});

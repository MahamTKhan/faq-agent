import { after } from "next/server";
import { db } from "@/lib/db";
import { extractText, titleFromFilename } from "@/lib/extract";
import { handle, HttpError, isUuid, json, readJson, requireAdmin, str } from "@/lib/http";
import { createDocument, normalizeKind } from "@/lib/kb";
import { extractActionItems } from "@/lib/tracker";

/** Emails and notes are scanned for action items in the background, after the response is sent. */
function scanLater(docId: string, kind: string) {
  if (kind !== "email" && kind !== "note") return;
  if (!process.env.ANTHROPIC_API_KEY) return;
  after(async () => {
    try {
      const sql = await db();
      await extractActionItems(sql, docId);
    } catch (e) {
      console.error("Action item extraction failed", e);
    }
  });
}

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Adds a document: JSON {title, kind, content} for pasted text / PDFs read in the browser, or multipart with `file`. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new HttpError(404, "Project not found.");
  const sql = await db();
  const [project] = await sql`SELECT id FROM projects WHERE id = ${id}`;
  if (!project) throw new HttpError(404, "Project not found.");

  const type = req.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "No file received.");
    if (file.size > 4_400_000) throw new HttpError(413, `${file.name} is larger than 4 MB. Paste its text instead, or split it.`);
    const { text, kind } = await extractText(file);
    if (!text.trim()) throw new HttpError(400, `No text could be read from ${file.name}.`);
    const title = str(form.get("title"), 300).trim() || titleFromFilename(file.name);
    const finalKind = form.get("kind") ? normalizeKind(form.get("kind")) : kind;
    const docId = await createDocument(sql, id, {
      title,
      kind: finalKind,
      content: text.slice(0, 2_000_000),
      sourceName: file.name,
      shared: form.get("shared") === "true",
    });
    scanLater(docId, finalKind);
    return json({ id: docId, chars: text.length }, 201);
  }

  const body = await readJson(req);
  const content = str(body.content, 2_000_000).trim();
  if (!content) throw new HttpError(400, "There's no text to save.");
  const title = str(body.title, 300).trim() || content.split("\n")[0].slice(0, 80) || "Untitled";
  const kind = normalizeKind(body.kind);
  const docId = await createDocument(sql, id, {
    title,
    kind,
    content,
    sourceName: str(body.source_name, 300),
    shared: body.shared === true,
  });
  scanLater(docId, kind);
  return json({ id: docId, chars: content.length }, 201);
});

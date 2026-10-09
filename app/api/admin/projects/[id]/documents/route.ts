import { db } from "@/lib/db";
import { extractText, titleFromFilename } from "@/lib/extract";
import { handle, HttpError, isUuid, json, readJson, requireAdmin, str } from "@/lib/http";
import { createDocument, normalizeKind } from "@/lib/kb";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    const docId = await createDocument(sql, id, {
      title,
      kind: form.get("kind") ? normalizeKind(form.get("kind")) : kind,
      content: text.slice(0, 2_000_000),
      sourceName: file.name,
    });
    return json({ id: docId, chars: text.length }, 201);
  }

  const body = await readJson(req);
  const content = str(body.content, 2_000_000).trim();
  if (!content) throw new HttpError(400, "There's no text to save.");
  const title = str(body.title, 300).trim() || content.split("\n")[0].slice(0, 80) || "Untitled";
  const docId = await createDocument(sql, id, {
    title,
    kind: normalizeKind(body.kind),
    content,
    sourceName: str(body.source_name, 300),
  });
  return json({ id: docId, chars: content.length }, 201);
});

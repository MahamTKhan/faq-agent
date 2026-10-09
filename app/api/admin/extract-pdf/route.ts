import { pdfToMarkdown } from "@/lib/claude";
import { handle, HttpError, json, requireAdmin, str } from "@/lib/http";

export const runtime = "nodejs";
// Each call reads ~3 pages so it fits within Vercel's 60-second limit on every plan.
export const maxDuration = 60;

/** Receives one slice of a PDF (split in the browser) and returns it as Markdown. */
export const POST = handle(async (req: Request) => {
  await requireAdmin(req);
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(500, "ANTHROPIC_API_KEY is not set, so PDFs can't be read yet.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No PDF received.");
  if (file.size > 4_400_000) throw new HttpError(413, "This part of the PDF is over 4 MB.");
  const name = str(form.get("name"), 300) || "the document";
  const from = Number(form.get("from")) || 1;
  const to = Number(form.get("to")) || from;
  const total = Number(form.get("total")) || to;
  const label =
    total > 1 ? `pages ${from}–${to} (of ${total}) of the PDF "${name}". Continue numbering and headings naturally; do not add a title of your own` : `the PDF "${name}"`;
  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const { markdown, truncated } = await pdfToMarkdown(b64, label);
  return json({ markdown, truncated });
});

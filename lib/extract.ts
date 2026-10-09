// Turns uploaded files into plain text / Markdown for the knowledge base.
// PDFs are handled separately (split in the browser, read by Claude) — see app/api/admin/extract-pdf.

import { HttpError } from "./http";

const TEXT_EXT = ["txt", "md", "markdown", "csv", "tsv", "json", "log", "xml", "yaml", "yml"];

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function titleFromFilename(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").trim() || "Untitled";
}

/** Small HTML → Markdown converter, good enough for Word (mammoth) output and simple HTML files. */
export function htmlToMarkdown(html: string): string {
  let s = html.replace(/\r/g, "");
  s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "");
  // Tables
  s = s.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) =>
      [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
        inline(c[1]).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim(),
      ),
    );
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
    const lines = [`| ${pad(rows[0]).join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`];
    for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
    return `\n\n${lines.join("\n")}\n\n`;
  });
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${"#".repeat(Number(n))} ${inline(t).trim()}\n\n`);
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${inline(t).trim()}`);
  s = s.replace(/<\/(ul|ol)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div)>/gi, "\n\n");
  s = inline(s);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function inline(s: string): string {
  return decodeEntities(
    s
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_")
      .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<img[^>]*>/gi, "")
      .replace(/<[^>]+>/g, ""),
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function emailBlock(h: { from?: string; to?: string; cc?: string; date?: string; subject?: string }, body: string) {
  const lines = [
    h.subject && `Subject: ${h.subject}`,
    h.from && `From: ${h.from}`,
    h.to && `To: ${h.to}`,
    h.cc && `Cc: ${h.cc}`,
    h.date && `Date: ${h.date}`,
  ].filter(Boolean);
  return `${lines.join("\n")}\n\n${body.trim()}`;
}

export async function extractText(file: File): Promise<{ text: string; kind: "document" | "email" }> {
  const ext = extOf(file.name);
  const buf = Buffer.from(await file.arrayBuffer());

  if (TEXT_EXT.includes(ext) || (!ext && file.type.startsWith("text/"))) {
    return { text: buf.toString("utf8"), kind: "document" };
  }
  if (ext === "html" || ext === "htm") {
    return { text: htmlToMarkdown(buf.toString("utf8")), kind: "document" };
  }
  if (ext === "docx") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.convertToHtml({ buffer: buf });
    return { text: htmlToMarkdown(value), kind: "document" };
  }
  if (ext === "eml") {
    const { simpleParser } = await import("mailparser");
    const m = await simpleParser(buf);
    const addr = (a: unknown) => (a && typeof a === "object" && "text" in a ? String((a as { text: string }).text) : Array.isArray(a) ? a.map((x) => x.text).join(", ") : "");
    const body = m.text || (m.html ? htmlToMarkdown(String(m.html)) : "");
    return {
      text: emailBlock({ subject: m.subject, from: addr(m.from), to: addr(m.to), cc: addr(m.cc), date: m.date?.toISOString() }, body),
      kind: "email",
    };
  }
  if (ext === "msg") {
    const mod = await import("@kenjiuno/msgreader");
    const MsgReader = (mod as unknown as { default: new (b: ArrayBuffer) => { getFileData(): Record<string, unknown> } }).default;
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const d = new MsgReader(ab).getFileData() as {
      subject?: string;
      body?: string;
      bodyHtml?: string;
      senderName?: string;
      senderEmail?: string;
      recipients?: { name?: string; email?: string }[];
      messageDeliveryTime?: string;
      clientSubmitTime?: string;
      error?: string;
    };
    if (d.error) throw new HttpError(400, `Couldn't read ${file.name}: ${d.error}`);
    const to = (d.recipients || []).map((r) => (r.email ? `${r.name || ""} <${r.email}>`.trim() : r.name)).filter(Boolean).join(", ");
    const body = d.body || (d.bodyHtml ? htmlToMarkdown(d.bodyHtml) : "");
    return {
      text: emailBlock(
        { subject: d.subject, from: d.senderEmail ? `${d.senderName || ""} <${d.senderEmail}>`.trim() : d.senderName, to, date: d.messageDeliveryTime || d.clientSubmitTime },
        body,
      ),
      kind: "email",
    };
  }
  if (ext === "pdf") {
    throw new HttpError(400, "PDFs are uploaded through the PDF reader. Please refresh the page and try again.");
  }
  throw new HttpError(
    400,
    `${file.name}: this file type isn't supported. Use PDF, Word (.docx), email (.eml/.msg), text, Markdown, CSV or HTML — or paste the text.`,
  );
}

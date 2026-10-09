import { pdfToMarkdown } from "./claude";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

/** The forwarding address for a project: your Postmark inbound address with +key added. */
export function inboundAddressFor(key: string | null | undefined): string {
  const base = (process.env.INBOUND_EMAIL_ADDRESS || "").trim();
  if (!base || !key || !base.includes("@")) return "";
  const [local, domain] = base.split("@");
  return `${local.split("+")[0]}+${key}@${domain}`;
}

type Addr = { Email?: string; MailboxHash?: string };
export type InboundEmail = {
  From?: string;
  FromName?: string;
  FromFull?: Addr & { Name?: string };
  To?: string;
  ToFull?: Addr[];
  CcFull?: Addr[];
  BccFull?: Addr[];
  Cc?: string;
  OriginalRecipient?: string;
  MailboxHash?: string;
  Subject?: string;
  Date?: string;
  TextBody?: string;
  HtmlBody?: string;
  Attachments?: { Name?: string; Content?: string; ContentType?: string; ContentLength?: number }[];
};

/** Which project the email was sent to, from the "+key" part of the address. */
export function projectKeyOf(m: InboundEmail): string {
  const clean = (s: string | undefined) => (s || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (clean(m.MailboxHash)) return clean(m.MailboxHash);
  for (const list of [m.ToFull, m.CcFull, m.BccFull]) for (const a of list || []) if (clean(a.MailboxHash)) return clean(a.MailboxHash);
  for (const s of [m.OriginalRecipient, m.To, m.Cc]) {
    const hit = /\+([a-z0-9]+)@/i.exec(s || "");
    if (hit) return clean(hit[1]);
  }
  return "";
}

/**
 * Only you (and addresses you allow) can add emails. Allowed: ADMIN_EMAIL, each project's alert address,
 * and anything in INBOUND_ALLOWED_SENDERS (comma-separated addresses, or "@company.com" for a whole domain).
 */
export async function senderAllowed(sql: Sql, from: string): Promise<boolean> {
  const sender = from.trim().toLowerCase();
  if (!sender) return false;
  const rows = await sql<{ notify_email: string }[]>`SELECT notify_email FROM projects WHERE notify_email <> ''`;
  const allowed = [process.env.ADMIN_EMAIL || "", process.env.INBOUND_ALLOWED_SENDERS || "", ...rows.map((r) => r.notify_email)]
    .join(",")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.some((a) => (a.startsWith("@") ? sender.endsWith(a) : sender === a));
}

/** Reads a PDF on the server in 3-page slices (used for PDFs attached to forwarded emails). */
export async function readPdfServer(buf: Buffer, name: string, maxPages = 40): Promise<{ text: string; pages: number } | null> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total > maxPages) return null;
  const ranges: [number, number][] = [];
  for (let s = 0; s < total; s += 3) ranges.push([s, Math.min(total, s + 3)]);
  const out: string[] = new Array(ranges.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, ranges.length) }, async () => {
      while (next < ranges.length) {
        const i = next++;
        const [a, b] = ranges[i];
        const part = await PDFDocument.create();
        const pages = await part.copyPages(src, Array.from({ length: b - a }, (_, k) => a + k));
        pages.forEach((p) => part.addPage(p));
        const b64 = Buffer.from(await part.save()).toString("base64");
        const label = total > 3 ? `pages ${a + 1}–${b} (of ${total}) of the PDF "${name}". Continue numbering and headings naturally; do not add a title of your own` : `the PDF "${name}"`;
        out[i] = (await pdfToMarkdown(b64, label)).markdown;
      }
    }),
  );
  return { text: out.join("\n\n"), pages: total };
}

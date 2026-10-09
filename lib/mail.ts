import nodemailer from "nodemailer";
import { appName } from "./http";

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

export async function sendMail(msg: { to: string; subject: string; text: string; html?: string; replyTo?: string }) {
  if (!msg.to) return { sent: false, reason: "no recipient" };
  if (!mailConfigured()) {
    console.log(`[mail not sent – SMTP not configured] to=${msg.to} subject=${msg.subject}`);
    return { sent: false, reason: "SMTP not configured" };
  }
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    replyTo: msg.replyTo || undefined,
  });
  return { sent: true };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const para = (s: string) => escapeHtml(s).replace(/\n/g, "<br>");

/** A plain, email-client-safe layout. */
export function emailHtml(opts: { heading: string; blocks: { label?: string; body: string; tone?: "muted" | "highlight" }[]; button?: { href: string; text: string }; footer?: string }) {
  const blocks = opts.blocks
    .map((b) => {
      const bg = b.tone === "highlight" ? "#eef6f4" : b.tone === "muted" ? "#f6f5f2" : "#ffffff";
      const border = b.tone === "highlight" ? "#1f6f63" : "#e3e0d9";
      return `<tr><td style="padding:0 0 14px 0">
        ${b.label ? `<div style="font:600 12px/1.4 Arial,sans-serif;color:#6b675f;text-transform:uppercase;letter-spacing:.04em;margin:0 0 6px">${escapeHtml(b.label)}</div>` : ""}
        <div style="font:15px/1.55 Arial,sans-serif;color:#1d1b18;background:${bg};border-left:3px solid ${border};padding:12px 14px;border-radius:4px">${para(b.body)}</div>
      </td></tr>`;
    })
    .join("");
  const button = opts.button
    ? `<tr><td style="padding:6px 0 18px"><a href="${escapeHtml(opts.button.href)}" style="display:inline-block;background:#1f6f63;color:#ffffff;font:600 14px Arial,sans-serif;text-decoration:none;padding:11px 18px;border-radius:6px">${escapeHtml(opts.button.text)}</a></td></tr>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f5f2;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e3e0d9;border-radius:8px">
  <tr><td style="padding:22px 24px 8px">
    <div style="font:600 12px Arial,sans-serif;color:#1f6f63;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(appName())}</div>
    <h1 style="font:600 20px/1.3 Arial,sans-serif;color:#1d1b18;margin:6px 0 18px">${escapeHtml(opts.heading)}</h1>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${blocks}${button}</table>
    ${opts.footer ? `<p style="font:12px/1.5 Arial,sans-serif;color:#8a857b;margin:4px 0 14px">${para(opts.footer)}</p>` : ""}
  </td></tr></table></body></html>`;
}

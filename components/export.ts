"use client";

/** Wraps rendered HTML in a standalone document that prints well and opens in Word. */
export function htmlShell(title: string, inner: string): string {
  const esc = title.replace(/[<>&]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc}</title><style>
    @page { margin: 16mm 14mm; }
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Calibri,"Segoe UI",Arial,sans-serif;font-size:10.5pt;line-height:1.45;color:#111;max-width:820px;margin:24px auto;padding:0 20px}
    h1{font-size:19pt;margin:0 0 4pt} h2{font-size:13.5pt;margin:0 0 4pt} h3{font-size:10.5pt;margin:10pt 0 3pt}
    table{border-collapse:collapse;width:100%;margin:6pt 0 10pt} th,td{border:1px solid #d0d4dc;padding:4pt 6pt;text-align:left;vertical-align:top}
    th{background:#f1f3f7;font-weight:600} ul{margin:2pt 0 6pt;padding-left:16pt} li{margin:1pt 0}
    h1,h2,h3{break-after:avoid;page-break-after:avoid} li,tr{break-inside:avoid}
  </style></head><body>${inner}</body></html>`;
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Opens the browser's print dialog for the document; choose "Save as PDF" to download it. */
export function printHtml(html: string) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
  return true;
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 90) || "report";

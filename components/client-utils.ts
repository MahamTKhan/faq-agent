"use client";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** fetch wrapper: JSON in/out, throws ApiError with the server's message. Admin 401s bounce to /login. */
export async function api<T = any>(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const res = await fetch(url, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: { ...(opts.body && !isForm ? { "content-type": "application/json" } : {}), ...(opts.headers || {}) },
    body: opts.body ? (isForm ? (opts.body as FormData) : JSON.stringify(opts.body)) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && url.startsWith("/api/admin")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    if (res.status === 413) throw new ApiError(413, data.error || "That file is too large to upload (max 4 MB).");
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function sizeLabel(chars: number): string {
  const words = Math.round(chars / 6);
  if (words < 1000) return `${words} words`;
  return `${(words / 1000).toFixed(words < 10000 ? 1 : 0)}k words`;
}

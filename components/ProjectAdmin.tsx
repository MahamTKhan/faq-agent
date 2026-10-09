"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AdminBar from "./AdminBar";
import { api, sizeLabel, timeAgo } from "./client-utils";
import Markdown from "./Markdown";
import { ActivityChart, StatTiles, type DayPoint, type Totals } from "./charts";

type Project = {
  id: string;
  name: string;
  client_name: string;
  slug: string;
  access_code: string;
  welcome_message: string;
  starter_questions: string;
  notify_email: string;
  active: boolean;
  created_at: string;
};
type Doc = { id: string; title: string; kind: string; source_name: string; chars: number; created_at: string; updated_at: string };
type Question = {
  id: string;
  conversation_id: string | null;
  question: string;
  bot_reply: string;
  suggested_reply: string;
  admin_note: string;
  final_reply: string;
  visitor_email: string;
  status: "open" | "answered" | "dismissed";
  created_at: string;
  answered_at: string | null;
};
type Conversation = {
  id: string;
  visitor_name: string;
  visitor_email: string;
  created_at: string;
  last_message_at: string;
  message_count: number;
  first_question: string | null;
  escalated_count: number;
};
type Data = { project: Project; documents: Doc[]; questions: Question[]; conversations: Conversation[]; adminEmail: string };
type Tab = "questions" | "insights" | "knowledge" | "conversations" | "settings";

function useToast() {
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), error ? 6000 : 3000);
  }, []);
  const node = toast ? <div className={`toast${toast.error ? " error" : ""}`}>{toast.text}</div> : null;
  return { show, node };
}

export default function ProjectAdmin({ id, appName, mailReady, aiReady }: { id: string; appName: string; mailReady: boolean; aiReady: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("questions");
  const [focusQ, setFocusQ] = useState("");
  const [origin, setOrigin] = useState("");
  const toast = useToast();

  const reload = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/admin/projects/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    setOrigin(window.location.origin);
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab") as Tab | null;
    const q = params.get("q");
    if (q) {
      setFocusQ(q);
      setTab("questions");
    } else if (t && ["questions", "insights", "knowledge", "conversations", "settings"].includes(t)) setTab(t);
    reload();
  }, [reload]);

  // Default to the knowledge base for a project with no questions yet.
  const first = useRef(true);
  useEffect(() => {
    if (!data || !first.current) return;
    first.current = false;
    const params = new URLSearchParams(window.location.search);
    if (!params.get("tab") && !params.get("q") && data.questions.length === 0) setTab("knowledge");
  }, [data]);

  function go(t: Tab) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }

  if (error && !data) {
    return (
      <>
        <AdminBar appName={appName} />
        <main className="page">
          <div className="notice error">{error}</div>
        </main>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <AdminBar appName={appName} />
        <main className="page row muted">
          <span className="spinner" /> Loading project…
        </main>
      </>
    );
  }

  const p = data.project;
  const link = `${origin}/p/${p.slug}`;
  const open = data.questions.filter((q) => q.status === "open").length;

  return (
    <>
      <AdminBar appName={appName}>
        <span className="faint hide-sm">/</span>
        <Link href="/admin" className="small muted hide-sm">
          Projects
        </Link>
      </AdminBar>
      <main className="page stack-lg">
        <section className="stack">
          <div className="row wrap" style={{ alignItems: "flex-start" }}>
            <div className="grow">
              <h1>{p.name}</h1>
              <p className="muted">{p.client_name || "No client set"}</p>
            </div>
            {!p.active && <span className="badge danger">Client link is switched off</span>}
          </div>
          <div className="row wrap">
            <div className="share grow" style={{ minWidth: 260 }}>
              <span className="tiny muted nowrap">Client link</span>
              <code className="mono small">{link}</code>
              <button
                className="btn btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText(p.access_code ? `${link}\nAccess code: ${p.access_code}` : link);
                  toast.show(p.access_code ? "Link and access code copied" : "Link copied");
                }}
              >
                Copy
              </button>
              <a className="btn btn-sm" href={link} target="_blank" rel="noreferrer">
                Open
              </a>
            </div>
            {p.access_code ? (
              <span className="badge">
                Access code: <span className="mono">{p.access_code}</span>
              </span>
            ) : (
              <span className="badge warn" title="Anyone with the link can use it. Add an access code in Settings.">
                No access code
              </span>
            )}
          </div>
          {(!aiReady || !mailReady) && (
            <div className="notice">
              <span>
                {!aiReady && <>The assistant can&apos;t answer yet — add <code>ANTHROPIC_API_KEY</code> in Vercel. </>}
                {!mailReady && <>Emails are off — add the <code>SMTP_…</code> settings in Vercel to get question alerts and email replies to clients.</>}
              </span>
            </div>
          )}
        </section>

        <div className="tabs">
          <button className={`tab${tab === "questions" ? " active" : ""}`} onClick={() => go("questions")}>
            Questions <span className={`count${open ? " hot" : ""}`}>{open}</span>
          </button>
          <button className={`tab${tab === "insights" ? " active" : ""}`} onClick={() => go("insights")}>
            Insights
          </button>
          <button className={`tab${tab === "knowledge" ? " active" : ""}`} onClick={() => go("knowledge")}>
            Knowledge base <span className="count">{data.documents.length}</span>
          </button>
          <button className={`tab${tab === "conversations" ? " active" : ""}`} onClick={() => go("conversations")}>
            Conversations <span className="count">{data.conversations.length}</span>
          </button>
          <button className={`tab${tab === "settings" ? " active" : ""}`} onClick={() => go("settings")}>
            Settings
          </button>
        </div>

        {tab === "questions" && <QuestionsTab data={data} reload={reload} toast={toast.show} mailReady={mailReady} focusId={focusQ} />}
        {tab === "insights" && <InsightsTab projectId={data.project.id} oldestOpen={data.questions.filter((q) => q.status === "open").map((q) => q.created_at).sort()[0] || null} />}
        {tab === "knowledge" && <KnowledgeTab data={data} reload={reload} toast={toast.show} aiReady={aiReady} />}
        {tab === "conversations" && <ConversationsTab data={data} reload={reload} />}
        {tab === "settings" && <SettingsTab data={data} reload={reload} toast={toast.show} />}
      </main>
      {toast.node}
    </>
  );
}

/* ───────────────────────────── Insights ───────────────────────────── */

function InsightsTab({ projectId, oldestOpen }: { projectId: string; oldestOpen: string | null }) {
  const [stats, setStats] = useState<{ totals: Totals; daily: DayPoint[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ totals: Totals; daily: DayPoint[] }>(`/api/admin/projects/${projectId}/stats`)
      .then(setStats)
      .catch((e) => setError(e.message));
  }, [projectId]);
  if (error) return <div className="notice error">{error}</div>;
  if (!stats)
    return (
      <div className="row muted">
        <span className="spinner" /> Loading insights…
      </div>
    );
  return (
    <section className="stack-lg">
      <StatTiles t={stats.totals} oldestOpen={oldestOpen} />
      <div className="card">
        <ActivityChart data={stats.daily} title="Client questions" subtitle="Last 30 days, this project" />
      </div>
      {stats.totals.answerRate30 !== null && stats.totals.answerRate30 < 0.7 && (
        <div className="notice info">
          <span>
            The assistant answered fewer than 7 in 10 questions here. Check the Questions tab for what clients ask about, and add documents or answered
            questions that cover it.
          </span>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────── Questions ───────────────────────────── */

function QuestionsTab({ data, reload, toast, mailReady, focusId }: { data: Data; reload: () => Promise<void>; toast: (t: string, e?: boolean) => void; mailReady: boolean; focusId: string }) {
  const [filter, setFilter] = useState<"open" | "answered" | "dismissed">(() => {
    const f = data.questions.find((q) => q.id === focusId);
    return f ? f.status : "open";
  });
  const [viewConv, setViewConv] = useState<string | null>(null);
  const list = data.questions.filter((q) => q.status === filter);
  const counts = {
    open: data.questions.filter((q) => q.status === "open").length,
    answered: data.questions.filter((q) => q.status === "answered").length,
    dismissed: data.questions.filter((q) => q.status === "dismissed").length,
  };

  return (
    <section className="stack">
      <div className="row wrap">
        {(["open", "answered", "dismissed"] as const).map((f) => (
          <button key={f} className={`btn btn-sm${filter === f ? " btn-primary" : ""}`} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)} · {counts[f]}
          </button>
        ))}
      </div>
      {list.length === 0 && (
        <div className="card card-pad muted">
          {filter === "open"
            ? "Nothing waiting. Questions the assistant can't answer from the knowledge base will show up here, and you'll get an email."
            : `No ${filter} questions.`}
        </div>
      )}
      {list.map((q) => (
        <QuestionCard key={q.id} q={q} reload={reload} toast={toast} mailReady={mailReady} highlight={q.id === focusId} onViewConversation={setViewConv} />
      ))}
      {viewConv && <ConversationModal id={viewConv} onClose={() => setViewConv(null)} />}
    </section>
  );
}

function QuestionCard({
  q,
  reload,
  toast,
  mailReady,
  highlight,
  onViewConversation,
}: {
  q: Question;
  reload: () => Promise<void>;
  toast: (t: string, e?: boolean) => void;
  mailReady: boolean;
  highlight: boolean;
  onViewConversation: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState(q.final_reply || q.suggested_reply);
  const [email, setEmail] = useState(q.visitor_email);
  const [sendEmail, setSendEmail] = useState(Boolean(q.visitor_email) && mailReady);
  const [addToKb, setAddToKb] = useState(true);
  const [busy, setBusy] = useState("");
  const [showBot, setShowBot] = useState(false);

  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight]);
  useEffect(() => {
    if (email && mailReady && !q.visitor_email) setSendEmail(true);
  }, [email, mailReady, q.visitor_email]);

  const placeholders = (reply.match(/\[CONFIRM:[^\]]*\]/gi) || []).length;

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const r = await api<{ emailed?: boolean; docId?: string }>(`/api/admin/questions/${q.id}`, { method: "PATCH", body: { action, email, ...extra } });
      if (action === "answer") {
        toast([r.emailed ? "Emailed to the client" : "Posted in their chat", r.docId ? "added to the knowledge base" : ""].filter(Boolean).join(" · "));
      } else if (action === "dismiss") toast("Dismissed");
      else if (action === "reopen") toast("Moved back to open");
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy("");
    }
  }

  return (
    <div ref={ref} className={`card q-card${highlight ? " highlight" : ""}`}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="grow stack" style={{ gap: 6 }}>
          <div className="tiny muted">
            Asked {timeAgo(q.created_at)}
            {q.status === "answered" && q.answered_at ? ` · answered ${timeAgo(q.answered_at)}` : ""}
          </div>
          <div className="q-text">{q.question}</div>
        </div>
        {q.conversation_id && (
          <button className="btn btn-sm btn-ghost" onClick={() => onViewConversation(q.conversation_id!)}>
            View chat
          </button>
        )}
      </div>

      {q.admin_note && (
        <div className="notice info small">
          <span>
            <b>What&apos;s missing:</b> {q.admin_note}
          </span>
        </div>
      )}

      <div>
        <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => setShowBot(!showBot)}>
          {showBot ? "▾" : "▸"} What the assistant told them
        </button>
        {showBot && (
          <div className="quote" style={{ marginTop: 6 }}>
            <Markdown>{q.bot_reply || "—"}</Markdown>
          </div>
        )}
      </div>

      {q.status === "answered" ? (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Your answer</span>
          <div className="quote" style={{ color: "var(--ink)" }}>
            <Markdown>{q.final_reply}</Markdown>
          </div>
          {q.visitor_email && <span className="tiny muted">Client: {q.visitor_email}</span>}
        </div>
      ) : (
        <>
          <div className="kv">
            <span className="muted">Client email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Not given yet — add it if you know it" />
          </div>
          <label className="field">
            <span className="label">Reply {q.suggested_reply ? <span className="faint">(suggested by the assistant — edit before sending)</span> : null}</span>
            <textarea className="textarea" rows={8} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write your answer…" />
            {placeholders > 0 && (
              <div className="hint" style={{ color: "var(--warn)" }}>
                {placeholders} [CONFIRM: …] item{placeholders > 1 ? "s" : ""} to check and remove before sending.
              </div>
            )}
          </label>
          <div className="row wrap" style={{ gap: 18 }}>
            <label className="check" title={mailReady ? "" : "Email isn't set up yet (SMTP settings)."}>
              <input type="checkbox" checked={sendEmail} disabled={!mailReady} onChange={(e) => setSendEmail(e.target.checked)} /> Email it to the client
            </label>
            <label className="check">
              <input type="checkbox" checked={addToKb} onChange={(e) => setAddToKb(e.target.checked)} /> Add to knowledge base
            </label>
          </div>
          <div className="row wrap">
            <button className="btn btn-primary" disabled={!reply.trim() || placeholders > 0 || Boolean(busy) || (sendEmail && !email)} onClick={() => act("answer", { reply, sendEmail, addToKb })}>
              {busy === "answer" && <span className="spinner" />}
              {sendEmail ? "Send answer" : "Post answer in chat"}
            </button>
            <button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => act(q.status === "dismissed" ? "reopen" : "dismiss")}>
              {q.status === "dismissed" ? "Reopen" : "Dismiss"}
            </button>
            <span className="tiny muted grow" style={{ minWidth: 200 }}>
              The answer always appears in the client&apos;s chat when they come back.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── Knowledge base ───────────────────────────── */

type UploadItem = { key: string; name: string; state: "reading" | "saving" | "done" | "error"; done: number; total: number; message: string };

const PAGES_PER_PART = 3;
const ACCEPT = ".pdf,.docx,.eml,.msg,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.log";

function KnowledgeTab({ data, reload, toast, aiReady }: { data: Data; reload: () => Promise<void>; toast: (t: string, e?: boolean) => void; aiReady: boolean }) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState<{ open: boolean; title: string; kind: string; content: string }>({ open: false, title: "", kind: "email", content: "" });
  const [savingPaste, setSavingPaste] = useState(false);
  const [viewDoc, setViewDoc] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectId = data.project.id;

  const update = (key: string, patch: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function readPdf(file: File, key: string): Promise<{ text: string; truncated: boolean }> {
    const { PDFDocument } = await import("pdf-lib");
    const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { ignoreEncryption: true });
    const total = src.getPageCount();
    update(key, { total, message: `Reading ${total} page${total === 1 ? "" : "s"} (diagrams included)…` });
    let done = 0;
    let truncated = false;

    async function readRange(a: number, b: number): Promise<string> {
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, Array.from({ length: b - a }, (_, i) => a + i));
      pages.forEach((pg) => out.addPage(pg));
      const bytes = await out.save();
      if (bytes.byteLength > 3_900_000 && b - a > 1) {
        const mid = a + Math.floor((b - a) / 2);
        return `${await readRange(a, mid)}\n\n${await readRange(mid, b)}`;
      }
      if (bytes.byteLength > 4_300_000) throw new Error(`Page ${a + 1} is over 4 MB on its own, so it can't be read. Paste its text instead.`);
      const fd = new FormData();
      fd.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), "part.pdf");
      fd.append("name", file.name);
      fd.append("from", String(a + 1));
      fd.append("to", String(b));
      fd.append("total", String(total));
      const r = await api<{ markdown: string; truncated: boolean }>("/api/admin/extract-pdf", { body: fd });
      if (r.truncated) truncated = true;
      done += b - a;
      update(key, { done });
      return r.markdown;
    }

    const ranges: [number, number][] = [];
    for (let s = 0; s < total; s += PAGES_PER_PART) ranges.push([s, Math.min(total, s + PAGES_PER_PART)]);
    const results: string[] = new Array(ranges.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(4, ranges.length) }, async () => {
      while (next < ranges.length) {
        const i = next++;
        results[i] = await readRange(ranges[i][0], ranges[i][1]);
      }
    });
    await Promise.all(workers);
    return { text: results.join("\n\n"), truncated };
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const items = list.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, state: "reading" as const, done: 0, total: 0, message: "Reading…" }));
    setUploads((u) => [...items, ...u]);
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const key = items[i].key;
      try {
        if (/\.pdf$/i.test(file.name)) {
          if (!aiReady) throw new Error("PDF reading needs ANTHROPIC_API_KEY to be set.");
          const { text, truncated } = await readPdf(file, key);
          update(key, { state: "saving", message: "Saving…" });
          await api(`/api/admin/projects/${projectId}/documents`, {
            body: { title: file.name.replace(/\.pdf$/i, "").replace(/_/g, " "), kind: "document", content: text, source_name: file.name },
          });
          update(key, { state: "done", message: truncated ? "Added — a part was very long and may be cut short. Open it to check." : "Added" });
        } else {
          if (file.size > 4_400_000) throw new Error("Larger than 4 MB. Paste its text instead.");
          const fd = new FormData();
          fd.append("file", file);
          update(key, { state: "saving", message: "Reading and saving…" });
          await api(`/api/admin/projects/${projectId}/documents`, { body: fd });
          update(key, { state: "done", message: "Added" });
        }
        await reload();
      } catch (e) {
        update(key, { state: "error", message: (e as Error).message });
      }
    }
  }

  async function savePaste(e: React.FormEvent) {
    e.preventDefault();
    setSavingPaste(true);
    try {
      await api(`/api/admin/projects/${projectId}/documents`, { body: { title: paste.title, kind: paste.kind, content: paste.content } });
      setPaste({ open: false, title: "", kind: "email", content: "" });
      toast("Added to the knowledge base");
      await reload();
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setSavingPaste(false);
    }
  }

  const total = data.documents.reduce((n, d) => n + d.chars, 0);

  return (
    <section className="stack-lg">
      <div className="notice">
        <span>
          Everything in the knowledge base can be quoted to anyone with the client link. Leave out internal-only notes, pricing you haven&apos;t shared, and other
          clients&apos; details.
        </span>
      </div>

      <div className="stack">
        <div
          className={`dropzone${over ? " over" : ""}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <div style={{ fontWeight: 600 }}>Drop files here, or click to choose</div>
          <div className="small muted">PDF (diagrams are read too), Word, Outlook .msg / .eml emails, text, Markdown, CSV, HTML · up to 4 MB each (PDFs any size)</div>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {uploads.length > 0 && (
          <div className="card">
            <div className="list">
              {uploads.map((u) => (
                <div key={u.key} className="list-item">
                  <div className="grow stack" style={{ gap: 6 }}>
                    <div className="row">
                      <span className="ellipsis grow" style={{ fontWeight: 560 }}>
                        {u.name}
                      </span>
                      {u.state === "done" && <span className="badge accent">Added</span>}
                      {u.state === "error" && <span className="badge danger">Failed</span>}
                      {(u.state === "reading" || u.state === "saving") && <span className="spinner faint" />}
                    </div>
                    {u.total > 0 && u.state === "reading" && (
                      <div className="progress">
                        <div style={{ width: `${Math.max(4, (u.done / u.total) * 100)}%` }} />
                      </div>
                    )}
                    <div className={`tiny ${u.state === "error" ? "" : "muted"}`} style={u.state === "error" ? { color: "var(--danger)" } : undefined}>
                      {u.state === "reading" && u.total ? `${u.done} of ${u.total} pages read · ` : ""}
                      {u.message}
                    </div>
                  </div>
                  {(u.state === "done" || u.state === "error") && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!paste.open ? (
          <div>
            <button className="btn" onClick={() => setPaste({ ...paste, open: true })}>
              Paste an email thread or notes
            </button>
          </div>
        ) : (
          <form className="card card-pad stack" onSubmit={savePaste}>
            <h2>Paste text</h2>
            <div className="row wrap" style={{ alignItems: "flex-start" }}>
              <label className="field grow" style={{ minWidth: 240 }}>
                <span className="label">Title</span>
                <input className="input" value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} placeholder="e.g. Email – VPN access for Wavetec team (12 Sep)" />
              </label>
              <label className="field" style={{ width: 200 }}>
                <span className="label">Type</span>
                <select className="select" value={paste.kind} onChange={(e) => setPaste({ ...paste, kind: e.target.value })}>
                  <option value="email">Email thread</option>
                  <option value="document">Document</option>
                  <option value="note">Note</option>
                  <option value="faq">Answered question</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span className="label">Text</span>
              <textarea className="textarea" rows={10} value={paste.content} onChange={(e) => setPaste({ ...paste, content: e.target.value })} placeholder="Paste the whole thread, including who said what and the dates." />
            </label>
            <div className="row">
              <button className="btn btn-primary" disabled={!paste.content.trim() || savingPaste}>
                {savingPaste && <span className="spinner" />} Add to knowledge base
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setPaste({ ...paste, open: false })}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2 className="grow">Sources</h2>
          <span className="tiny muted">
            {data.documents.length} item{data.documents.length === 1 ? "" : "s"} · {sizeLabel(total)}
          </span>
        </div>
        {data.documents.length === 0 ? (
          <div className="card-pad muted">Nothing here yet. Add the project&apos;s documents and email threads above — the assistant only answers from what&apos;s here.</div>
        ) : (
          <div className="list">
            {data.documents.map((d) => (
              <div key={d.id} className="list-item clickable" onClick={() => setViewDoc(d.id)}>
                <div className={`doc-icon ${d.kind}`}>{d.kind === "email" ? "MAIL" : d.kind === "faq" ? "Q&A" : d.kind === "note" ? "NOTE" : (d.source_name.split(".").pop() || "DOC").slice(0, 4).toUpperCase()}</div>
                <div className="grow">
                  <div className="ellipsis" style={{ fontWeight: 560 }}>
                    {d.title}
                  </div>
                  <div className="tiny muted ellipsis">
                    {sizeLabel(d.chars)} · updated {timeAgo(d.updated_at)}
                    {d.source_name ? ` · ${d.source_name}` : ""}
                  </div>
                </div>
                <span className="btn btn-sm btn-ghost hide-sm">Open</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {viewDoc && (
        <DocModal
          id={viewDoc}
          onClose={() => setViewDoc(null)}
          onChanged={async (msg) => {
            toast(msg);
            await reload();
          }}
        />
      )}
    </section>
  );
}

function DocModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (msg: string) => Promise<void> }) {
  const [doc, setDoc] = useState<{ title: string; kind: string; content: string; source_name: string } | null>(null);
  const [draft, setDraft] = useState({ title: "", kind: "document", content: "" });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ document: { title: string; kind: string; content: string; source_name: string } }>(`/api/admin/documents/${id}`)
      .then((d) => {
        setDoc(d.document);
        setDraft({ title: d.document.title, kind: d.document.kind, content: d.document.content });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/documents/${id}`, { method: "PATCH", body: draft });
      await onChanged("Saved");
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm("Remove this from the knowledge base? The assistant will no longer use it.")) return;
    setBusy(true);
    try {
      await api(`/api/admin/documents/${id}`, { method: "DELETE" });
      await onChanged("Removed");
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title={editing ? "Edit source" : doc?.title || "Loading…"}>
      <div className="modal-body stack">
        {error && <div className="notice error">{error}</div>}
        {!doc ? (
          <div className="row muted">
            <span className="spinner" /> Loading…
          </div>
        ) : editing ? (
          <>
            <div className="row wrap" style={{ alignItems: "flex-start" }}>
              <label className="field grow" style={{ minWidth: 240 }}>
                <span className="label">Title</span>
                <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label className="field" style={{ width: 200 }}>
                <span className="label">Type</span>
                <select className="select" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                  <option value="document">Document</option>
                  <option value="email">Email thread</option>
                  <option value="note">Note</option>
                  <option value="faq">Answered question</option>
                </select>
              </label>
            </div>
            <textarea className="textarea mono" style={{ minHeight: "50vh", fontSize: 13 }} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
          </>
        ) : (
          <>
            {doc.source_name && <div className="tiny muted">From {doc.source_name}</div>}
            <Markdown>{doc.content}</Markdown>
          </>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost btn-danger" onClick={remove} disabled={busy || !doc} style={{ marginRight: "auto" }}>
          Remove
        </button>
        {editing ? (
          <>
            <button className="btn" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !draft.content.trim()}>
              {busy && <span className="spinner" />} Save
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setEditing(true)} disabled={!doc}>
            Edit text
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Conversations ───────────────────────────── */

function ConversationsTab({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const [view, setView] = useState<string | null>(null);
  return (
    <section className="card">
      {data.conversations.length === 0 ? (
        <div className="card-pad muted">No conversations yet. Share the client link to get started.</div>
      ) : (
        <div className="list">
          {data.conversations.map((c) => (
            <div key={c.id} className="list-item clickable" onClick={() => setView(c.id)}>
              <div className="grow">
                <div className="ellipsis" style={{ fontWeight: 560 }}>
                  {c.first_question || "(no messages)"}
                </div>
                <div className="tiny muted ellipsis">
                  {c.visitor_name || c.visitor_email ? [c.visitor_name, c.visitor_email].filter(Boolean).join(" · ") : "Anonymous"} · {c.message_count} messages · {timeAgo(c.last_message_at)}
                </div>
              </div>
              {c.escalated_count > 0 && <span className="badge warn">{c.escalated_count} sent to you</span>}
            </div>
          ))}
        </div>
      )}
      {view && (
        <ConversationModal
          id={view}
          onClose={() => setView(null)}
          onDeleted={async () => {
            setView(null);
            await reload();
          }}
        />
      )}
    </section>
  );
}

function ConversationModal({ id, onClose, onDeleted }: { id: string; onClose: () => void; onDeleted?: () => Promise<void> }) {
  const [msgs, setMsgs] = useState<{ id: string; role: string; content: string; status: string; sources: string[]; created_at: string }[] | null>(null);
  const [meta, setMeta] = useState<{ visitor_name: string; visitor_email: string; created_at: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/api/admin/conversations/${id}`)
      .then((d) => {
        setMsgs(d.messages);
        setMeta(d.conversation);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <Modal onClose={onClose} title="Conversation">
      <div className="modal-body stack">
        {meta && (
          <div className="tiny muted">
            {[meta.visitor_name, meta.visitor_email].filter(Boolean).join(" · ") || "Anonymous"} · started {timeAgo(meta.created_at)}
          </div>
        )}
        {error && <div className="notice error">{error}</div>}
        {!msgs && !error && (
          <div className="row muted">
            <span className="spinner" /> Loading…
          </div>
        )}
        {msgs?.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "team" && <div className="who">You (project team)</div>}
            <div className="bubble">{m.role === "user" ? m.content : <Markdown>{m.content}</Markdown>}</div>
            {m.role === "assistant" && (m.status === "escalated" || m.sources?.length > 0) && (
              <div className="msg-meta">
                {m.status === "escalated" && <span className="badge warn">Sent to you</span>}
                {m.sources?.map((s) => (
                  <span key={s} className="source-chip ellipsis">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {onDeleted && (
        <div className="modal-foot">
          <button
            className="btn btn-ghost btn-danger"
            style={{ marginRight: "auto" }}
            onClick={async () => {
              if (!confirm("Delete this conversation? Its questions stay in your inbox.")) return;
              await api(`/api/admin/conversations/${id}`, { method: "DELETE" });
              await onDeleted();
            }}
          >
            Delete conversation
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────────── Settings ───────────────────────────── */

function SettingsTab({ data, reload, toast }: { data: Data; reload: () => Promise<void>; toast: (t: string, e?: boolean) => void }) {
  const p = data.project;
  const [f, setF] = useState({
    name: p.name,
    client_name: p.client_name,
    access_code: p.access_code,
    welcome_message: p.welcome_message,
    starter_questions: p.starter_questions,
    notify_email: p.notify_email,
  });
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try {
      await api(`/api/admin/projects/${p.id}`, { method: "PATCH", body });
      toast(msg);
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  function makeCode() {
    const words = ["kiosk", "harbor", "cedar", "orbit", "maple", "falcon", "delta", "summit", "river", "atlas"];
    const w = words[Math.floor(Math.random() * words.length)];
    setF({ ...f, access_code: `${w}-${Math.floor(1000 + Math.random() * 9000)}` });
  }

  return (
    <section className="stack-lg">
      <form
        className="card card-pad stack"
        onSubmit={(e) => {
          e.preventDefault();
          patch(f, "Settings saved");
        }}
      >
        <h2>Project</h2>
        <div className="row wrap" style={{ alignItems: "flex-start" }}>
          <label className="field grow" style={{ minWidth: 220 }}>
            <span className="label">Project name</span>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label className="field grow" style={{ minWidth: 220 }}>
            <span className="label">Client</span>
            <input className="input" value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span className="label">Access code</span>
          <div className="row">
            <input className="input mono" value={f.access_code} onChange={(e) => setF({ ...f, access_code: e.target.value })} placeholder="Leave empty to let anyone with the link in" />
            <button type="button" className="btn" onClick={makeCode}>
              Generate
            </button>
          </div>
          <div className="hint">Recommended. Clients enter it once per browser. Share it separately from the link if you can.</div>
        </label>
        <label className="field">
          <span className="label">Welcome message</span>
          <textarea className="textarea" rows={3} value={f.welcome_message} onChange={(e) => setF({ ...f, welcome_message: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Suggested questions</span>
          <textarea
            className="textarea"
            rows={5}
            value={f.starter_questions}
            onChange={(e) => setF({ ...f, starter_questions: e.target.value })}
            placeholder={"One per line, e.g.\nWhat servers does the bank need to provide?\nWhich URLs need to be whitelisted?\nWhat happens if a server goes down?"}
          />
          <div className="hint">Shown as buttons on the client&apos;s first screen. Up to 8.</div>
        </label>
        <label className="field">
          <span className="label">Send question alerts to</span>
          <input className="input" value={f.notify_email} onChange={(e) => setF({ ...f, notify_email: e.target.value })} placeholder={data.adminEmail || "you@company.com"} />
          <div className="hint">Leave empty to use {data.adminEmail || "ADMIN_EMAIL"}. Separate several addresses with commas.</div>
        </label>
        <div>
          <button className="btn btn-primary" disabled={busy || !f.name.trim()}>
            {busy && <span className="spinner" />} Save settings
          </button>
        </div>
      </form>

      <div className="card card-pad stack">
        <h2>Client link</h2>
        <div className="row wrap">
          <button className="btn" disabled={busy} onClick={() => patch({ active: !p.active }, p.active ? "Client link switched off" : "Client link switched on")}>
            {p.active ? "Switch link off" : "Switch link on"}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              if (confirm("Make a new link? The current link will stop working immediately.")) patch({ regenerate_slug: true }, "New link created");
            }}
          >
            Make a new link
          </button>
        </div>
        <p className="small muted">Switching off shows clients a “link not active” page. A new link is useful if the old one was shared too widely.</p>
      </div>

      <div className="card card-pad stack">
        <h2>Delete project</h2>
        <p className="small muted">Deletes the project, its knowledge base, conversations and questions. This can&apos;t be undone.</p>
        <div>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              const typed = prompt(`Type the project name to delete it:\n${p.name}`);
              if (typed?.trim() !== p.name.trim()) return;
              await api(`/api/admin/projects/${p.id}`, { method: "DELETE" });
              window.location.href = "/admin";
            }}
          >
            Delete project
          </button>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── Modal ───────────────────────────── */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true">
        <div className="card-head">
          <h2 className="grow ellipsis">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

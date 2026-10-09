"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, timeAgo } from "./client-utils";
import Markdown from "./Markdown";
import Modal from "./Modal";
import type { Data } from "./ProjectAdmin";

type Toast = (t: string, e?: boolean) => void;

/* ───────────────────────────── Tracker ───────────────────────────── */

type Item = {
  id: string;
  title: string;
  owner: "client" | "us";
  owner_name: string;
  due_date: string | null;
  status: "suggested" | "open" | "done" | "dismissed";
  source_quote: string;
  done_hint: string;
  origin: "manual" | "ai";
  created_at: string;
  done_at: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

function DueChip({ due, done }: { due: string | null; done?: boolean }) {
  if (!due) return null;
  const d = new Date(`${due}T12:00:00Z`);
  const late = !done && due < today();
  const soon = !done && !late && (d.getTime() - Date.now()) / 86_400_000 < 3;
  const label = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <span className={`age${late ? " late" : ""}`} title={late ? "Overdue" : soon ? "Due soon" : "Due date"}>
      {late ? `Overdue, ${label}` : `Due ${label}`}
    </span>
  );
}

export function TrackerTab({ data, reload, toast, aiReady }: { data: Data; reload: () => Promise<void>; toast: Toast; aiReady: boolean }) {
  const pid = data.project.id;
  const clientLabel = data.project.client_name || "the client";
  const [items, setItems] = useState<Item[] | null>(null);
  const [form, setForm] = useState({ title: "", owner: "client", owner_name: "", due_date: "" });
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Item[] }>(`/api/admin/projects/${pid}/items`)).items);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }, [pid, toast]);
  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>, msg?: string) {
    try {
      await api(`/api/admin/items/${id}`, { method: "PATCH", body });
      if (msg) toast(msg);
      await Promise.all([load(), reload()]);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/admin/projects/${pid}/items`, { body: form });
      setForm({ title: "", owner: form.owner, owner_name: "", due_date: "" });
      setAdding(false);
      toast("Added");
      await Promise.all([load(), reload()]);
    } catch (err) {
      toast((err as Error).message, true);
    }
  }

  if (!items)
    return (
      <div className="row muted">
        <span className="spinner" /> Loading tracker…
      </div>
    );

  const suggested = items.filter((i) => i.status === "suggested");
  const open = items.filter((i) => i.status === "open");
  const done = items.filter((i) => i.status === "done");
  const column = (owner: "client" | "us") => open.filter((i) => i.owner === owner);

  const Row = ({ i }: { i: Item }) => (
    <div className="list-item" style={{ alignItems: "flex-start" }}>
      <input
        type="checkbox"
        className="tick"
        aria-label={`Mark "${i.title}" done`}
        checked={i.status === "done"}
        onChange={() => patch(i.id, { status: i.status === "done" ? "open" : "done" }, i.status === "done" ? "Reopened" : "Marked done")}
      />
      <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
        <button className="link-btn" onClick={() => setEditing(i)} title="Edit">
          {i.title}
        </button>
        <div className="row wrap" style={{ gap: 6 }}>
          {i.owner_name && <span className="tiny muted">{i.owner_name}</span>}
          <DueChip due={i.due_date} done={i.status === "done"} />
          {i.status === "done" && i.done_at && <span className="tiny muted">Done {timeAgo(i.done_at)}</span>}
        </div>
        {i.done_hint && i.status === "open" && (
          <div className="notice info small" style={{ marginTop: 4 }}>
            <span className="grow">
              <b>Looks done:</b> “{i.done_hint}”
            </span>
            <button className="btn btn-sm" onClick={() => patch(i.id, { status: "done" }, "Marked done")}>
              Mark done
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => patch(i.id, { clear_hint: true })}>
              Keep open
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <section className="stack-lg">
      {suggested.length > 0 && (
        <div className="card review">
          <div className="card-head">
            <div className="grow">
              <h2>Found in emails</h2>
              <p className="tiny muted">Confirm what&apos;s right. Confirmed items show on the client&apos;s page and the assistant can mention them.</p>
            </div>
            <button
              className="btn btn-sm btn-primary"
              onClick={async () => {
                for (const s of suggested) await api(`/api/admin/items/${s.id}`, { method: "PATCH", body: { status: "open" } });
                toast(`Confirmed ${suggested.length} item${suggested.length === 1 ? "" : "s"}`);
                await Promise.all([load(), reload()]);
              }}
            >
              Confirm all
            </button>
          </div>
          <div className="list">
            {suggested.map((i) => (
              <div key={i.id} className="list-item" style={{ alignItems: "flex-start" }}>
                <div className="grow stack" style={{ gap: 5, minWidth: 0 }}>
                  <div style={{ fontWeight: 580 }}>{i.title}</div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className={`badge ${i.owner === "us" ? "accent" : "warn"}`}>{i.owner === "us" ? "On us" : `On ${clientLabel}`}</span>
                    {i.owner_name && <span className="tiny muted">{i.owner_name}</span>}
                    <DueChip due={i.due_date} />
                  </div>
                  {i.source_quote && <div className="quote small">“{i.source_quote}”</div>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => setEditing(i)}>
                    Edit
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => patch(i.id, { status: "open" }, "Confirmed")}>
                    Confirm
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => patch(i.id, { status: "dismissed" }, "Dismissed")}>
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="row wrap">
        <div className="grow">
          <h2>Who owes what</h2>
          <p className="small muted">
            {aiReady ? "Emails you add or forward are scanned for action items automatically. " : ""}Tick an item when it&apos;s done.
          </p>
        </div>
        {!adding && (
          <button className="btn" onClick={() => setAdding(true)}>
            Add item
          </button>
        )}
      </div>

      {adding && (
        <form className="card card-pad stack" onSubmit={add}>
          <label className="field">
            <span className="label">What needs to happen</span>
            <input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Share production API credentials" />
          </label>
          <div className="row wrap" style={{ alignItems: "flex-start" }}>
            <label className="field" style={{ width: 200 }}>
              <span className="label">Who</span>
              <select className="select" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
                <option value="client">{clientLabel}</option>
                <option value="us">Us</option>
              </select>
            </label>
            <label className="field grow" style={{ minWidth: 180 }}>
              <span className="label">Person or team (optional)</span>
              <input className="input" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} placeholder="e.g. Bank IT – network team" />
            </label>
            <label className="field" style={{ width: 180 }}>
              <span className="label">Due (optional)</span>
              <input className="input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={!form.title.trim()}>
              Add item
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="tracker-cols">
        {(["client", "us"] as const).map((owner) => {
          const list = column(owner);
          return (
            <div key={owner} className="card">
              <div className="card-head">
                <h3 className="grow">{owner === "client" ? `Waiting on ${clientLabel}` : "Waiting on us"}</h3>
                <span className="count">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <div className="card-pad small muted">Nothing open.</div>
              ) : (
                <div className="list">
                  {list.map((i) => (
                    <Row key={i.id} i={i} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {done.length > 0 && (
        <div className="card">
          <button className="card-head link-row" onClick={() => setShowDone(!showDone)}>
            <h3 className="grow" style={{ textAlign: "left" }}>
              {showDone ? "▾" : "▸"} Done
            </h3>
            <span className="count">{done.length}</span>
          </button>
          {showDone && (
            <div className="list">
              {done.map((i) => (
                <Row key={i.id} i={i} />
              ))}
            </div>
          )}
        </div>
      )}

      {editing && (
        <ItemModal
          item={editing}
          clientLabel={clientLabel}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await patch(editing.id, body, "Saved");
            setEditing(null);
          }}
          onDelete={async () => {
            if (!confirm("Delete this item?")) return;
            await api(`/api/admin/items/${editing.id}`, { method: "DELETE" });
            setEditing(null);
            toast("Deleted");
            await Promise.all([load(), reload()]);
          }}
        />
      )}
    </section>
  );
}

function ItemModal({
  item,
  clientLabel,
  onClose,
  onSave,
  onDelete,
}: {
  item: Item;
  clientLabel: string;
  onClose: () => void;
  onSave: (b: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [f, setF] = useState({ title: item.title, owner: item.owner, owner_name: item.owner_name, due_date: item.due_date || "" });
  return (
    <Modal title="Edit item" onClose={onClose}>
      <div className="modal-body stack">
        <label className="field">
          <span className="label">What needs to happen</span>
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </label>
        <div className="row wrap" style={{ alignItems: "flex-start" }}>
          <label className="field" style={{ width: 200 }}>
            <span className="label">Who</span>
            <select className="select" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value as "client" | "us" })}>
              <option value="client">{clientLabel}</option>
              <option value="us">Us</option>
            </select>
          </label>
          <label className="field grow" style={{ minWidth: 180 }}>
            <span className="label">Person or team</span>
            <input className="input" value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} />
          </label>
          <label className="field" style={{ width: 180 }}>
            <span className="label">Due</span>
            <input className="input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          </label>
        </div>
        {item.source_quote && <div className="quote small">From the email: “{item.source_quote}”</div>}
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost btn-danger" style={{ marginRight: "auto" }} onClick={onDelete}>
          Delete
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!f.title.trim()} onClick={() => onSave({ ...f, due_date: f.due_date || null })}>
          Save
        </button>
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Client docs ───────────────────────────── */

const TYPES: { kind: string; label: string; hint: string }[] = [
  { kind: "faq", label: "FAQ", hint: "Common questions from bank staff, answered simply" },
  { kind: "checklist", label: "Prerequisites checklist", hint: "Everything the client must provide or set up" },
  { kind: "brief", label: "Project brief", hint: "One-page overview for someone new" },
  { kind: "status", label: "Status update", hint: "Progress, who owes what, next steps" },
  { kind: "custom", label: "Something else", hint: "Describe it in your own words" },
];
const typeLabel = (k: string) => TYPES.find((t) => t.kind === k)?.label || "Document";

export function ClientDocsTab({ data, reload, toast, aiReady }: { data: Data; reload: () => Promise<void>; toast: Toast; aiReady: boolean }) {
  const [kind, setKind] = useState("faq");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState<string | null>(null);
  const docs = data.generated || [];

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function write() {
    setBusy(true);
    try {
      const r = await api<{ id: string; truncated: boolean }>(`/api/admin/projects/${data.project.id}/generate`, { body: { kind, instructions } });
      await reload();
      toast(r.truncated ? "Written, but it was very long and may be cut short at the end" : "Document ready");
      setInstructions("");
      setView(r.id);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack-lg">
      <div className="card card-pad stack">
        <div>
          <h2>Write a document from this project</h2>
          <p className="small muted">Built only from the knowledge base and tracker. Check it, edit it, then download it or show it on the client&apos;s page.</p>
        </div>
        <div className="type-grid" role="radiogroup" aria-label="Document type">
          {TYPES.map((t) => (
            <button key={t.kind} role="radio" aria-checked={kind === t.kind} className={`type-card${kind === t.kind ? " on" : ""}`} onClick={() => setKind(t.kind)}>
              <span className="t">{t.label}</span>
              <span className="h">{t.hint}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span className="label">{kind === "custom" ? "What should it be?" : "Anything to add? (optional)"}</span>
          <textarea
            className="textarea"
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={
              kind === "custom"
                ? "e.g. A one-page summary of open infrastructure issues for Monday's meeting with the bank's IT team"
                : "e.g. Focus on the DR site. Keep it under 2 pages."
            }
          />
        </label>
        <div className="row wrap">
          <button className="btn btn-primary" disabled={busy || !aiReady || (kind === "custom" && !instructions.trim())} onClick={write}>
            {busy && <span className="spinner" />} {busy ? "Writing…" : "Write document"}
          </button>
          {busy && <span className="small muted">Usually takes 1–2 minutes ({elapsed}s). You can stay on this page.</span>}
          {!aiReady && <span className="small muted">Needs ANTHROPIC_API_KEY.</span>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2 className="grow">Documents</h2>
          <span className="tiny muted">{docs.filter((d) => d.published).length} on the client&apos;s page</span>
        </div>
        {docs.length === 0 ? (
          <div className="card-pad muted">Nothing written yet.</div>
        ) : (
          <div className="list">
            {docs.map((d) => (
              <div key={d.id} className="list-item clickable" onClick={() => setView(d.id)}>
                <div className="doc-icon faq">{d.kind === "checklist" ? "☑" : d.kind === "status" ? "STAT" : d.kind.slice(0, 4).toUpperCase()}</div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="ellipsis" style={{ fontWeight: 560 }}>
                      {d.title}
                    </span>
                    {d.published && <span className="badge accent">On client page</span>}
                  </div>
                  <div className="tiny muted">
                    {typeLabel(d.kind)}, updated {timeAgo(d.updated_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {view && (
        <GeneratedModal
          id={view}
          onClose={() => setView(null)}
          onChanged={async (msg) => {
            if (msg) toast(msg);
            await reload();
          }}
        />
      )}
    </section>
  );
}

function slugName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "document";
}

function GeneratedModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (msg?: string) => Promise<void> }) {
  const [doc, setDoc] = useState<{ title: string; content: string; published: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ document: { title: string; content: string; published: boolean } }>(`/api/admin/generated/${id}`)
      .then((d) => {
        setDoc(d.document);
        setDraft(d.document.content);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  async function save(patch: Record<string, unknown>, msg: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/generated/${id}`, { method: "PATCH", body: patch });
      const title = typeof patch.content === "string" ? /^#\s+(.+)$/m.exec(patch.content)?.[1] : undefined;
      setDoc((d) => (d ? { ...d, ...patch, ...(title ? { title } : {}) } : d));
      await onChanged(msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function htmlDoc() {
    const inner = body.current?.innerHTML || "";
    return `<!doctype html><html><head><meta charset="utf-8"><title>${doc?.title || "Document"}</title><style>
      body{font-family:Calibri,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.5;color:#111;max-width:760px;margin:32px auto;padding:0 24px}
      h1{font-size:20pt;margin:0 0 12pt} h2{font-size:14pt;margin:18pt 0 6pt} h3{font-size:12pt}
      table{border-collapse:collapse;margin:8pt 0;width:100%} th,td{border:1px solid #bbb;padding:4pt 8pt;text-align:left;vertical-align:top} th{background:#f2f2f2}
      blockquote{border-left:3px solid #ccc;margin:0;padding-left:10pt;color:#444} code{font-family:Consolas,monospace}
      ul.contains-task-list{list-style:none;padding-left:4pt}
    </style></head><body>${inner}</body></html>`;
  }

  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <Modal onClose={onClose} title={doc?.title || "Loading…"}>
      <div className="modal-body stack">
        {error && <div className="notice error">{error}</div>}
        {!doc ? (
          <div className="row muted">
            <span className="spinner" /> Loading…
          </div>
        ) : editing ? (
          <textarea className="textarea mono" style={{ minHeight: "55vh", fontSize: 13 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <>
            <div className="notice small">
              <span>Written by AI from the project&apos;s sources. Read it through before sharing.</span>
            </div>
            <div ref={body} className="doc-render">
              <Markdown>{doc.content}</Markdown>
            </div>
          </>
        )}
      </div>
      <div className="modal-foot wrap">
        {editing ? (
          <>
            <button className="btn" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !draft.trim()}
              onClick={async () => {
                await save({ content: draft }, "Saved");
                setEditing(false);
              }}
            >
              Save
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-ghost btn-danger"
              style={{ marginRight: "auto" }}
              disabled={busy || !doc}
              onClick={async () => {
                if (!confirm("Delete this document?")) return;
                await api(`/api/admin/generated/${id}`, { method: "DELETE" });
                await onChanged("Deleted");
                onClose();
              }}
            >
              Delete
            </button>
            <button className="btn" disabled={!doc} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              className="btn"
              disabled={!doc}
              onClick={() => {
                navigator.clipboard.writeText(doc!.content);
                onChanged("Copied as Markdown");
              }}
            >
              Copy
            </button>
            <button className="btn" disabled={!doc} onClick={() => download(`${slugName(doc!.title)}.doc`, htmlDoc(), "application/msword")}>
              Word
            </button>
            <button
              className="btn"
              disabled={!doc}
              onClick={() => {
                const w = window.open("", "_blank");
                if (!w) return;
                w.document.write(htmlDoc());
                w.document.close();
                w.focus();
                setTimeout(() => w.print(), 300);
              }}
            >
              PDF
            </button>
            <button
              className={`btn${doc?.published ? "" : " btn-primary"}`}
              disabled={busy || !doc}
              onClick={() => save({ published: !doc!.published }, doc!.published ? "Removed from the client's page" : "Shown on the client's page")}
            >
              {doc?.published ? "Hide from client" : "Show on client page"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AdminBar from "./AdminBar";
import { api, timeAgo } from "./client-utils";

type ProjectRow = {
  id: string;
  name: string;
  client_name: string;
  slug: string;
  active: boolean;
  doc_count: number;
  open_count: number;
  conversation_count: number;
  last_activity: string | null;
  created_at: string;
};

export default function AdminHome({ appName }: { appName: string }) {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", client_name: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ projects: ProjectRow[] }>("/api/admin/projects")
      .then((d) => setProjects(d.projects))
      .catch((e) => setError(e.message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: string }>("/api/admin/projects", { body: form });
      window.location.href = `/admin/projects/${id}?tab=knowledge`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const openTotal = projects?.reduce((n, p) => n + p.open_count, 0) || 0;

  return (
    <>
      <AdminBar appName={appName} />
      <main className="page stack-lg">
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="grow">
            <h1>Projects</h1>
            <p className="muted">
              {projects === null
                ? "Loading…"
                : openTotal > 0
                  ? `${openTotal} question${openTotal === 1 ? "" : "s"} waiting for your answer.`
                  : "No questions waiting. Each project has its own client link."}
            </p>
          </div>
          {!creating && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              + New project
            </button>
          )}
        </div>

        {error && <div className="notice error">{error}</div>}

        {creating && (
          <form className="card card-pad stack" onSubmit={create}>
            <h2>New project</h2>
            <div className="row wrap" style={{ alignItems: "flex-start" }}>
              <label className="field grow" style={{ minWidth: 220 }}>
                <span className="label">Project name</span>
                <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Self Service Kiosk – Infrastructure" />
              </label>
              <label className="field grow" style={{ minWidth: 220 }}>
                <span className="label">Client</span>
                <input className="input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} placeholder="e.g. Bank AL Habib" />
              </label>
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={!form.name.trim() || busy}>
                {busy && <span className="spinner" />} Create project
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {projects && projects.length === 0 && !creating && (
          <div className="card card-pad stack" style={{ alignItems: "flex-start" }}>
            <h2>Start your first project</h2>
            <p className="muted">
              Create a project, add its documents and email threads, then share the client link. The assistant answers from those documents and emails you
              anything it can&apos;t answer, with a suggested reply.
            </p>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              + New project
            </button>
          </div>
        )}

        {projects && projects.length > 0 && (
          <div className="project-grid">
            {projects.map((p) => (
              <Link key={p.id} href={`/admin/projects/${p.id}`} className="card project-card" style={p.active ? undefined : { opacity: 0.6 }}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div className="grow">
                    <h2 className="ellipsis">{p.name}</h2>
                    <div className="small muted ellipsis">{p.client_name || "No client set"}</div>
                  </div>
                  {p.open_count > 0 ? (
                    <span className="badge accent">
                      <span className="dot" /> {p.open_count} open
                    </span>
                  ) : !p.active ? (
                    <span className="badge">Link off</span>
                  ) : null}
                </div>
                <div className="stats">
                  <span>
                    <b>{p.doc_count}</b> docs
                  </span>
                  <span>
                    <b>{p.conversation_count}</b> chats
                  </span>
                  <span className="right">{p.last_activity ? `Active ${timeAgo(p.last_activity)}` : "No chats yet"}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

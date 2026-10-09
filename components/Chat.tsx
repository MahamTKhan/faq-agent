"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./client-utils";
import Markdown from "./Markdown";

type Msg = {
  id: string;
  role: "user" | "assistant" | "team";
  content: string;
  status: string;
  sources: string[];
  created_at: string;
  pending?: boolean;
};

type Props = {
  slug: string;
  projectName: string;
  clientName: string;
  welcome: string;
  starters: string[];
  requiresCode: boolean;
};

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k) || "";
    } catch {
      return "";
    }
  },
  set(k: string, v: string) {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch {
      /* private mode etc. */
    }
  },
};

export default function Chat({ slug, projectName, clientName, welcome, starters, requiresCode }: Props) {
  const keys = { cid: `faq:${slug}:cid`, code: `faq:${slug}:code`, name: `faq:name`, email: `faq:email` };
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(!requiresCode);
  const [ready, setReady] = useState(false);
  const [cid, setCid] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [askEmail, setAskEmail] = useState(false);
  const [contact, setContact] = useState({ name: "", email: "" });
  const [contactSaved, setContactSaved] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const headers = useCallback((c = code) => (c ? { "x-access-code": c } : undefined), [code]);

  const loadHistory = useCallback(
    async (conversationId: string, accessCode: string) => {
      if (!conversationId) return;
      const data = await api<{ messages: Msg[]; conversation: { visitor_email: string; visitor_name: string } | null }>(
        `/api/chat/${slug}?c=${encodeURIComponent(conversationId)}`,
        { headers: accessCode ? { "x-access-code": accessCode } : undefined },
      );
      if (!data.conversation) {
        store.set(keys.cid, "");
        setCid("");
        return;
      }
      setMessages(data.messages);
      if (data.conversation.visitor_email) setContactSaved(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug],
  );

  // Restore saved state on first load.
  useEffect(() => {
    const savedCode = store.get(keys.code);
    const savedCid = store.get(keys.cid);
    setContact({ name: store.get(keys.name), email: store.get(keys.email) });
    setCid(savedCid);
    (async () => {
      if (requiresCode && savedCode) {
        try {
          await api(`/api/chat/${slug}`, { headers: { "x-access-code": savedCode } });
          setCode(savedCode);
          setUnlocked(true);
          await loadHistory(savedCid, savedCode);
        } catch {
          store.set(keys.code, "");
        }
      } else if (!requiresCode) {
        await loadHistory(savedCid, "").catch(() => {});
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending, askEmail]);

  // While a question is with the team, check for their reply now and then.
  const waiting = (() => {
    const lastTeam = messages.map((m) => m.role).lastIndexOf("team");
    return messages.some((m, i) => m.status === "escalated" && i > lastTeam);
  })();
  useEffect(() => {
    if (!waiting || !cid) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadHistory(cid, code).catch(() => {});
    }, 45_000);
    return () => clearInterval(t);
  }, [waiting, cid, code, loadHistory]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/api/chat/${slug}`, { headers: { "x-access-code": code.trim() } });
      store.set(keys.code, code.trim());
      setCode(code.trim());
      setUnlocked(true);
      await loadHistory(cid, code.trim()).catch(() => {});
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That access code isn't right." : (err as Error).message);
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setError("");
    setInput("");
    setSending(true);
    const temp: Msg = { id: `tmp-${Date.now()}`, role: "user", content: message, status: "", sources: [], created_at: new Date().toISOString(), pending: true };
    setMessages((m) => [...m, temp]);
    try {
      const data = await api<{ conversationId: string; message: Msg; needsEmail: boolean }>(`/api/chat/${slug}`, {
        body: { message, conversationId: cid, name: contact.name, email: contact.email },
        headers: headers(),
      });
      setCid(data.conversationId);
      store.set(keys.cid, data.conversationId);
      setMessages((m) => [...m.map((x) => (x.id === temp.id ? { ...x, pending: false } : x)), data.message]);
      if (data.needsEmail && !contactSaved) setAskEmail(true);
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setInput(message);
      if (err instanceof ApiError && err.status === 401) {
        store.set(keys.code, "");
        setUnlocked(false);
      }
      setError((err as Error).message);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function saveContact(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/api/chat/${slug}/contact`, { body: { conversationId: cid, ...contact }, headers: headers() });
      store.set(keys.name, contact.name);
      store.set(keys.email, contact.email);
      setContactSaved(true);
      setAskEmail(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function newChat() {
    store.set(keys.cid, "");
    setCid("");
    setMessages([]);
    setAskEmail(false);
    setContactSaved(false);
    setError("");
    inputRef.current?.focus();
  }

  const header = (
    <header className="chat-head">
      <div className="chat-head-inner">
        <div className="brand-mark" aria-hidden>
          {projectName.trim().charAt(0).toUpperCase() || "?"}
        </div>
        <div className="grow">
          <div style={{ fontWeight: 620 }} className="ellipsis">
            {projectName}
          </div>
          <div className="tiny muted ellipsis">Project assistant{clientName ? ` · ${clientName}` : ""}</div>
        </div>
        {unlocked && messages.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={newChat}>
            New chat
          </button>
        )}
      </div>
    </header>
  );

  if (!ready) {
    return (
      <div className="chat-shell">
        {header}
        <div className="center-screen" style={{ minHeight: "60vh" }}>
          <div className="spinner faint" />
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="chat-shell">
        {header}
        <main className="center-screen" style={{ minHeight: "70vh" }}>
          <form className="card card-pad auth-card stack" onSubmit={unlock}>
            <h2>Enter access code</h2>
            <p className="muted small">The project team shared an access code with this link.</p>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Access code" autoFocus autoComplete="off" />
            {error && <div className="notice error">{error}</div>}
            <button className="btn btn-primary" disabled={!code.trim()}>
              Continue
            </button>
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="chat-shell">
      {header}
      <main className="chat-body">
        {messages.length === 0 && (
          <section className="hero">
            <h1>How can I help?</h1>
            {welcome && <p className="muted" style={{ maxWidth: 620 }}>{welcome}</p>}
            {starters.length > 0 && (
              <div className="starters" style={{ marginTop: 14 }}>
                {starters.map((s) => (
                  <button key={s} className="starter" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "team" && <div className="who">Reply from the project team</div>}
            <div className="bubble" style={m.pending ? { opacity: 0.75 } : undefined}>
              {m.role === "user" ? m.content : <Markdown>{m.content}</Markdown>}
            </div>
            {m.role === "assistant" && (m.sources?.length > 0 || m.status === "escalated") && (
              <div className="msg-meta">
                {m.status === "escalated" && (
                  <span className="badge warn">
                    <span className="dot" /> Sent to the team
                  </span>
                )}
                {m.sources?.map((s) => (
                  <span key={s} className="source-chip ellipsis" title={s}>
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="msg assistant">
            <div className="bubble typing" aria-label="Thinking">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {askEmail && !contactSaved && (
          <form className="card card-pad stack" onSubmit={saveContact} style={{ maxWidth: 560 }}>
            <div>
              <h3>Where should the team reply?</h3>
              <p className="muted small">Leave your email and they&apos;ll send the answer there. It will also show up in this chat.</p>
            </div>
            <div className="row wrap">
              <input className="input grow" style={{ minWidth: 160 }} placeholder="Your name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
              <input
                className="input grow"
                style={{ minWidth: 200 }}
                type="email"
                required
                placeholder="you@bank.com"
                value={contact.email}
                onChange={(e) => setContact({ ...contact, email: e.target.value })}
              />
            </div>
            <div className="row">
              <button className="btn btn-primary btn-sm">Save</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAskEmail(false)}>
                Not now
              </button>
            </div>
          </form>
        )}
        {contactSaved && waiting && (
          <p className="tiny muted" style={{ textAlign: "center" }}>
            The team will reply by email. You can also come back to this page — replies appear here.
          </p>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="chat-foot">
        <div className="chat-foot-inner stack" style={{ gap: 8 }}>
          {error && <div className="notice error">{error}</div>}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder="Ask a question about the project…"
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              maxLength={4000}
              autoFocus
            />
            <button className="btn btn-primary send" disabled={!input.trim() || sending} aria-label="Send">
              {sending ? (
                <span className="spinner" />
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              )}
            </button>
          </form>
          <p className="tiny faint" style={{ textAlign: "center" }}>
            Answers come from the project documents. Anything not covered goes to the project team.
          </p>
        </div>
      </footer>
    </div>
  );
}

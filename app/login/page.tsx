"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/components/client-utils";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { body: { password } });
      const next = params.get("next") || "/admin";
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="card card-pad auth-card stack" onSubmit={submit}>
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="brand-mark">P</div>
        <h2>Admin sign in</h2>
      </div>
      <label className="field">
        <span className="label">Password</span>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
      </label>
      {error && <div className="notice error">{error}</div>}
      <button className="btn btn-primary" disabled={!password || busy}>
        {busy ? <span className="spinner" /> : null} Sign in
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="center-screen">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

"use client";

import Link from "next/link";
import { api } from "./client-utils";

export default function AdminBar({ appName, children }: { appName: string; children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Link href="/admin" className="brand">
        <span className="brand-mark">{appName.charAt(0).toUpperCase()}</span>
        <span className="hide-sm">{appName}</span>
      </Link>
      {children}
      <span className="spacer" />
      <button
        className="btn btn-ghost btn-sm"
        onClick={async () => {
          await api("/api/auth/logout", { body: {} }).catch(() => {});
          window.location.href = "/login";
        }}
      >
        Sign out
      </button>
    </header>
  );
}

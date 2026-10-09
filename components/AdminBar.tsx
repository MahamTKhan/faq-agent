"use client";

import Link from "next/link";
import { api } from "./client-utils";
import ThemeToggle from "./ThemeToggle";

export default function AdminBar({ appName, children, active }: { appName: string; children?: React.ReactNode; active?: "dashboard" }) {
  return (
    <header className="topbar">
      <Link href="/admin" className="brand">
        <span className="brand-mark">{appName.charAt(0).toUpperCase()}</span>
        <span className="hide-sm">{appName}</span>
      </Link>
      <nav className="nav-links">
        <Link href="/admin" className={`nav-link${active === "dashboard" ? " active" : ""}`}>
          Dashboard
        </Link>
      </nav>
      {children}
      <span className="spacer" />
      <ThemeToggle />
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

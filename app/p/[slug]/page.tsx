import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Chat from "@/components/Chat";
import { db } from "@/lib/db";
import { projectBySlug, type PublicProject } from "@/lib/project";

export const dynamic = "force-dynamic";

async function load(slug: string): Promise<PublicProject | null> {
  try {
    const sql = await db();
    return await projectBySlug(sql, slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await load(slug);
  return { title: p ? `${p.name} – Project assistant` : "Project assistant" };
}

export default async function ClientChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await load(slug);
  if (!p) notFound();
  return (
    <Chat
      slug={p.slug}
      projectName={p.name}
      clientName={p.client_name}
      welcome={p.welcome_message}
      starters={p.starter_questions
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8)}
      requiresCode={Boolean(p.access_code)}
    />
  );
}

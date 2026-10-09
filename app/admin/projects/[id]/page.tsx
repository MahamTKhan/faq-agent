import ProjectAdmin from "@/components/ProjectAdmin";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProjectAdmin
      id={id}
      appName={process.env.APP_NAME || "Project Desk"}
      mailReady={Boolean(process.env.SMTP_HOST)}
      aiReady={Boolean(process.env.ANTHROPIC_API_KEY)}
    />
  );
}

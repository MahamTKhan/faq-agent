import AdminHome from "@/components/AdminHome";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminHome appName={process.env.APP_NAME || "Project Desk"} />;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth, authEnabled } from "@/auth";
import { AdminDashboard } from "@/components/AdminDashboard";

export const metadata: Metadata = { title: "Статистика · QorgauAI" };

// The API decides who is an admin (ADMIN_EMAILS); this page only requires a
// session and shows the API's 403 to everyone else.
export default async function AdminPage() {
  await connection();
  if (authEnabled && !(await auth())?.user?.email) redirect("/");
  return <AdminDashboard />;
}

import { connection } from "next/server";
import { Dashboard } from "@/components/dashboard";
import { loadGrades } from "@/lib/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  await connection();
  const data = await loadGrades();
  return <Dashboard data={data} />;
}

import { probeDatabaseHealth } from "@/modules/workflow/database-health";
import { getLivenessStatus } from "@/modules/workflow/health";

export async function GET() {
  const health = await getLivenessStatus(probeDatabaseHealth);
  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

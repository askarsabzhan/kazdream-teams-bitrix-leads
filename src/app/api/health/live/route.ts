import { getLivenessStatus } from "@/modules/workflow/health";

export function GET() {
  return Response.json(getLivenessStatus());
}

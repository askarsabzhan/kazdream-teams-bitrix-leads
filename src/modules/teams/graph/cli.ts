import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { requireServerEnvironment } from "../../../lib/env/server";
import { runGraphDiagnostics } from "./diagnostics";
import { formatGraphDiagnostics } from "./format";

function loadLocalEnvironment(): void {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const environment = requireServerEnvironment([
    "MS_TENANT_ID",
    "MS_CLIENT_ID",
    "MS_CLIENT_SECRET",
    "MS_TEAM_NAME",
    "MS_CHANNEL_NAME",
  ] as const);
  const credentials = {
    tenantId: environment.MS_TENANT_ID,
    clientId: environment.MS_CLIENT_ID,
    clientSecret: environment.MS_CLIENT_SECRET,
  };
  const report = await runGraphDiagnostics({
    credentials,
    teamName: environment.MS_TEAM_NAME,
    channelName: environment.MS_CHANNEL_NAME,
  });

  console.log(
    formatGraphDiagnostics(report, [
      credentials.tenantId,
      credentials.clientId,
      credentials.clientSecret,
    ]),
  );
  if (report.auth.status === "FAIL") process.exitCode = 1;
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.message.startsWith("Missing required"))
    console.error(error.message);
  else
    console.error("Graph diagnostics failed before a safe report was produced.");
  process.exitCode = 1;
});

import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { requireServerEnvironment } from "../../lib/env/server";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

import { BitrixClient } from "./client";
import { assertDiscoveryReady, discoverBitrix } from "./discovery";
import { BitrixSyncError } from "./errors";
import {
  formatCrmSyncSummary,
  formatDiscoveryChecks,
  formatProtectedChecks,
} from "./format";
import { GraphManagerDirectory } from "./graph-users";
import { BitrixLeads } from "./leads";
import { SupabaseCrmSyncRepository } from "./repository";
import { BitrixUsers } from "./users";
import { verifyBitrixSync } from "./verification";
import { processCrmSync } from "./worker";

function loadLocalEnvironment(): void {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const environment = requireServerEnvironment([
    "BITRIX_WEBHOOK_BASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MS_TENANT_ID",
    "MS_CLIENT_ID",
    "MS_CLIENT_SECRET",
  ] as const);
  const bitrixClient = new BitrixClient(environment.BITRIX_WEBHOOK_BASE_URL);
  const discovery = await discoverBitrix(bitrixClient);
  console.log(formatDiscoveryChecks(discovery));
  assertDiscoveryReady(discovery);

  const repository = new SupabaseCrmSyncRepository(createSupabaseAdminClient());
  const bitrixLeads = new BitrixLeads(bitrixClient);
  const summary = await processCrmSync({
    repository,
    teamsDirectory: new GraphManagerDirectory({
      tenantId: environment.MS_TENANT_ID,
      clientId: environment.MS_CLIENT_ID,
      clientSecret: environment.MS_CLIENT_SECRET,
    }),
    bitrixUsers: new BitrixUsers(bitrixClient),
    bitrixLeads,
    discovery,
    workerId: `bitrix-cli-${process.pid}`,
    limit: 10,
    leaseSeconds: 300,
  });
  console.log(formatCrmSyncSummary(summary));
  const checks = await verifyBitrixSync({
    repository,
    bitrixLeads,
    discovery,
    expectedLeadCount: 2,
  });
  console.log(formatProtectedChecks(checks));
  if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  if (error instanceof BitrixSyncError) {
    console.error(`Bitrix synchronization stopped: ${error.code}.`);
  } else if (error instanceof Error && error.message.startsWith("Missing required")) {
    console.error(error.message);
  } else {
    console.error("Bitrix synchronization stopped before a safe summary was produced.");
  }
  process.exitCode = 1;
});

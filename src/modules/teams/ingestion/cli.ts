import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { requireServerEnvironment } from "../../../lib/env/server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { GraphRequestError } from "../graph/client";
import { GraphTeamsReader } from "../graph/reader";

import { parseTeamsIngestArguments } from "./cli-options";
import {
  formatIngestionReport,
  formatVerificationReport,
} from "./format";
import { ingestFetchedBatch } from "./ingest-channel";
import {
  SupabaseTeamsMessageRepository,
  TeamsMessagePersistenceError,
} from "./persist-message";
import {
  TeamsIngestionVerificationError,
  verifyPersistedChannel,
} from "./verify-channel";

function loadLocalEnvironment(): void {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const cliOptions = parseTeamsIngestArguments(process.argv.slice(2));
  const environment = requireServerEnvironment([
    "MS_TENANT_ID",
    "MS_CLIENT_ID",
    "MS_CLIENT_SECRET",
    "MS_TEAM_NAME",
    "MS_CHANNEL_NAME",
  ] as const);
  const reader = new GraphTeamsReader({
    tenantId: environment.MS_TENANT_ID,
    clientId: environment.MS_CLIENT_ID,
    clientSecret: environment.MS_CLIENT_SECRET,
  });
  const channel = await reader.resolveChannel(
    environment.MS_TEAM_NAME,
    environment.MS_CHANNEL_NAME,
  );
  if (cliOptions.verifyOnly) {
    const verification = await verifyPersistedChannel({
      client: createSupabaseAdminClient(),
      tenantId: environment.MS_TENANT_ID,
      teamId: channel.teamId,
      channelId: channel.channelId,
    });
    console.log(formatVerificationReport(verification));
    return;
  }
  const batch =
    cliOptions.mode === "latest"
      ? await reader.fetchLatest({
          channel,
          rootMessageLimit: cliOptions.limit,
        })
      : await reader.fetchCatchup({
          channel,
          since: cliOptions.since,
          until: cliOptions.until,
          messageLimit: cliOptions.limit,
        });
  const client = cliOptions.dryRun ? undefined : createSupabaseAdminClient();
  const summary = await ingestFetchedBatch({
    batch,
    tenantId: environment.MS_TENANT_ID,
    mode: cliOptions.mode,
    dryRun: cliOptions.dryRun,
    ...(client
      ? { repository: new SupabaseTeamsMessageRepository(client) }
      : {}),
  });
  const verification =
    cliOptions.verify && client
      ? await verifyPersistedChannel({
          client,
          tenantId: environment.MS_TENANT_ID,
          teamId: channel.teamId,
          channelId: channel.channelId,
        })
      : undefined;

  console.log(formatIngestionReport(summary, verification));
}

main().catch((error: unknown) => {
  if (error instanceof GraphRequestError)
    console.error(`Teams ingestion Graph step failed: ${error.safe.code}.`);
  else if (error instanceof TeamsMessagePersistenceError)
    console.error(`Teams ingestion database step failed: ${error.code}.`);
  else if (error instanceof TeamsIngestionVerificationError)
    console.error(`Teams ingestion verification failed: ${error.code}.`);
  else if (error instanceof Error && error.message.startsWith("Missing required"))
    console.error(error.message);
  else console.error("Teams ingestion failed before a safe summary was produced.");
  process.exitCode = 1;
});

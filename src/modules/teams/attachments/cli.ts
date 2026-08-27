import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { requireServerEnvironment } from "../../../lib/env/server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { ClientCredentialsTokenProvider } from "../graph/auth";
import { GraphClient } from "../graph/client";

import { acquireAttachmentBatch } from "./acquire";
import {
  AttachmentAcquireCliOptionsError,
  parseAttachmentAcquireArguments,
} from "./cli-options";
import { formatAttachmentAcquisitionSummary } from "./format";
import { GraphAttachmentByteSource } from "./graph-source";
import { SupabaseAttachmentAcquisitionRepository } from "./repository";
import { createSupabaseAttachmentObjectStorage } from "./storage";
import { AttachmentAcquisitionError } from "./types";

function loadLocalEnvironment(): void {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const cliOptions = parseAttachmentAcquireArguments(process.argv.slice(2));
  const environment = requireServerEnvironment([
    "MS_TENANT_ID",
    "MS_CLIENT_ID",
    "MS_CLIENT_SECRET",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const);
  const tokenProvider = new ClientCredentialsTokenProvider({
    tenantId: environment.MS_TENANT_ID,
    clientId: environment.MS_CLIENT_ID,
    clientSecret: environment.MS_CLIENT_SECRET,
  });
  const graphClient = new GraphClient(() => tokenProvider.getAccessToken());
  const supabase = createSupabaseAdminClient();
  const summary = await acquireAttachmentBatch({
    repository: new SupabaseAttachmentAcquisitionRepository(supabase),
    byteSource: new GraphAttachmentByteSource(
      graphClient,
      environment.MS_TENANT_ID,
    ),
    storage: createSupabaseAttachmentObjectStorage(supabase),
    limit: cliOptions.limit,
    leaseSeconds: cliOptions.leaseSeconds,
  });

  console.log(formatAttachmentAcquisitionSummary(summary));
}

main().catch((error: unknown) => {
  if (error instanceof AttachmentAcquisitionError) {
    console.error(`Attachment acquisition failed: ${error.code}.`);
  } else if (error instanceof AttachmentAcquireCliOptionsError) {
    console.error(error.message);
  } else if (
    error instanceof Error &&
    error.message.startsWith("Missing required")
  ) {
    console.error(error.message);
  } else {
    console.error(
      "Attachment acquisition failed before a safe summary was produced.",
    );
  }
  process.exitCode = 1;
});

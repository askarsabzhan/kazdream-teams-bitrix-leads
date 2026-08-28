import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { requireServerEnvironment } from "../../../lib/env/server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

import { formatGroupExtractionSummary } from "./format";
import { SupabaseGroupExtractionRepository } from "./repository";
import type { GroupExtractionSummary } from "./types";
import { GroupExtractionError } from "./types";
import { evaluateGroupExtractionChecks } from "./validation";

function loadLocalEnvironment(): void {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  requireServerEnvironment([
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const);
  const snapshots = await new SupabaseGroupExtractionRepository(
    createSupabaseAdminClient(),
  ).loadVerificationSnapshots();
  const summary: GroupExtractionSummary = {
    groupsSeen: snapshots.length,
    groupsProcessed: 0,
    failed: 0,
    openaiRequests: 0,
    candidateUpdates: 0,
    newFieldEvidence: 0,
    jobsCompleted: 0,
    providerDurationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    checks: evaluateGroupExtractionChecks(snapshots),
  };
  console.log(formatGroupExtractionSummary(summary));
}

main().catch((error: unknown) => {
  if (error instanceof GroupExtractionError) {
    console.error(`Group extraction verification failed: ${error.code}.`);
  } else if (error instanceof Error && error.message.startsWith("Missing required")) {
    console.error(error.message);
  } else {
    console.error("Group extraction verification failed before a safe summary was produced.");
  }
  process.exitCode = 1;
});

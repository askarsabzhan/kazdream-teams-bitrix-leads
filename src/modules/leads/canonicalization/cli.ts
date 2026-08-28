import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { requireServerEnvironment } from "../../../lib/env/server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import {
  createOpenAIClient,
  DEFAULT_OPENAI_SUMMARY_MODEL,
} from "../../ai/openai/client";
import { OpenAICanonicalSummaryProvider } from "../../ai/openai/canonical-summary";

import { formatCanonicalizationSummary } from "./format";
import { SupabaseCanonicalizationRepository } from "./repository";
import { CanonicalizationError } from "./types";
import { processCanonicalization } from "./worker";

function loadLocalEnvironment(): void {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const environment = requireServerEnvironment([
    "OPENAI_API_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const);
  const summary = await processCanonicalization({
    repository: new SupabaseCanonicalizationRepository(
      createSupabaseAdminClient(),
    ),
    summaryProvider: new OpenAICanonicalSummaryProvider(
      createOpenAIClient(environment.OPENAI_API_KEY),
      environment.OPENAI_SUMMARY_MODEL ?? DEFAULT_OPENAI_SUMMARY_MODEL,
    ),
    summaryLimit: 10,
    summaryLeaseSeconds: 300,
  });
  console.log(formatCanonicalizationSummary(summary));
}

main().catch((error: unknown) => {
  if (error instanceof CanonicalizationError) {
    console.error(`Canonicalization failed: ${error.code}.`);
  } else if (error instanceof Error && error.message.startsWith("Missing required")) {
    console.error(error.message);
  } else {
    console.error("Canonicalization failed before a safe summary was produced.");
  }
  process.exitCode = 1;
});

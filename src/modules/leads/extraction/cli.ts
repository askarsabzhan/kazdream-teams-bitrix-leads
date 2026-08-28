import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { requireServerEnvironment } from "../../../lib/env/server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import {
  createOpenAIClient,
  DEFAULT_OPENAI_EXTRACTION_MODEL,
} from "../../ai/openai/client";
import { OpenAIGroupExtractionProvider } from "../../ai/openai/group-extraction";

import {
  GroupExtractionCliOptionsError,
  parseGroupExtractionArguments,
} from "./cli-options";
import { formatGroupExtractionSummary } from "./format";
import { SupabaseGroupExtractionRepository } from "./repository";
import { GroupExtractionError } from "./types";
import { processGroupExtractionBatch } from "./worker";

function loadLocalEnvironment(): void {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const cliOptions = parseGroupExtractionArguments(process.argv.slice(2));
  const environment = requireServerEnvironment([
    "OPENAI_API_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const);
  const provider = new OpenAIGroupExtractionProvider(
    createOpenAIClient(environment.OPENAI_API_KEY),
    environment.OPENAI_EXTRACTION_MODEL ?? DEFAULT_OPENAI_EXTRACTION_MODEL,
  );
  const summary = await processGroupExtractionBatch({
    repository: new SupabaseGroupExtractionRepository(
      createSupabaseAdminClient(),
    ),
    provider,
    limit: cliOptions.limit,
    leaseSeconds: cliOptions.leaseSeconds,
  });
  console.log(formatGroupExtractionSummary(summary));
}

main().catch((error: unknown) => {
  if (error instanceof GroupExtractionError) {
    console.error(`Group extraction failed: ${error.code}.`);
  } else if (error instanceof GroupExtractionCliOptionsError) {
    console.error(error.message);
  } else if (error instanceof Error && error.message.startsWith("Missing required")) {
    console.error(error.message);
  } else {
    console.error("Group extraction failed before a safe summary was produced.");
  }
  process.exitCode = 1;
});

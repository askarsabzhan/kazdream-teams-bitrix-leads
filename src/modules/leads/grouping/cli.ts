import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

import {
  ConversationGroupingCliOptionsError,
  parseConversationGroupingArguments,
} from "./cli-options";
import { formatConversationGroupingSummary } from "./format";
import { SupabaseConversationGroupingRepository } from "./repository";
import { ConversationGroupingError } from "./types";
import { runConversationGrouping } from "./worker";

function loadLocalEnvironment(): void {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const options = parseConversationGroupingArguments(process.argv.slice(2));
  const summary = await runConversationGrouping({
    repository: new SupabaseConversationGroupingRepository(
      createSupabaseAdminClient(),
    ),
    limit: options.limit,
  });
  console.log(formatConversationGroupingSummary(summary));
}

main().catch((error: unknown) => {
  if (error instanceof ConversationGroupingError) {
    console.error(`Conversation grouping failed: ${error.code}.`);
  } else if (error instanceof ConversationGroupingCliOptionsError) {
    console.error(error.message);
  } else if (
    error instanceof Error &&
    error.message.startsWith("Missing required")
  ) {
    console.error(error.message);
  } else {
    console.error(
      "Conversation grouping failed before a safe summary was produced.",
    );
  }
  process.exitCode = 1;
});

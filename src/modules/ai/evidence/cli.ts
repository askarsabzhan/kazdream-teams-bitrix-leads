import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { requireServerEnvironment } from "../../../lib/env/server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import {
  createOpenAIClient,
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  DEFAULT_OPENAI_VISION_MODEL,
} from "../openai/client";
import { OpenAITranscriptionProvider } from "../openai/transcription";
import { OpenAIImageTextExtractionProvider } from "../openai/vision";

import {
  AttachmentEvidenceCliOptionsError,
  parseAttachmentEvidenceArguments,
} from "./cli-options";
import { formatAttachmentEvidenceSummary } from "./format";
import { SupabaseAttachmentEvidenceRepository } from "./repository";
import { createSupabaseAttachmentEvidenceStorage } from "./storage";
import { AttachmentEvidenceError } from "./types";
import { processAttachmentEvidenceBatch } from "./worker";

function loadLocalEnvironment(): void {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const cliOptions = parseAttachmentEvidenceArguments(process.argv.slice(2));
  const environment = requireServerEnvironment([
    "OPENAI_API_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const);
  const openai = createOpenAIClient(environment.OPENAI_API_KEY);
  const supabase = createSupabaseAdminClient();
  const summary = await processAttachmentEvidenceBatch({
    repository: new SupabaseAttachmentEvidenceRepository(supabase),
    storage: createSupabaseAttachmentEvidenceStorage(supabase),
    transcriptionProvider: new OpenAITranscriptionProvider(
      openai,
      environment.OPENAI_TRANSCRIPTION_MODEL ??
        DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
    ),
    imageProvider: new OpenAIImageTextExtractionProvider(
      openai,
      environment.OPENAI_VISION_MODEL ?? DEFAULT_OPENAI_VISION_MODEL,
    ),
    limit: cliOptions.limit,
    leaseSeconds: cliOptions.leaseSeconds,
  });
  console.log(formatAttachmentEvidenceSummary(summary));
}

main().catch((error: unknown) => {
  if (error instanceof AttachmentEvidenceError) {
    console.error(`Attachment AI evidence failed: ${error.code}.`);
  } else if (error instanceof AttachmentEvidenceCliOptionsError) {
    console.error(error.message);
  } else if (
    error instanceof Error &&
    error.message.startsWith("Missing required")
  ) {
    console.error(error.message);
  } else {
    console.error(
      "Attachment AI evidence failed before a safe summary was produced.",
    );
  }
  process.exitCode = 1;
});

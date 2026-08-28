import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireServerEnvironment } from "@/lib/env/server";
import {
  createOpenAIClient,
  DEFAULT_OPENAI_EXTRACTION_MODEL,
  DEFAULT_OPENAI_SUMMARY_MODEL,
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  DEFAULT_OPENAI_VISION_MODEL,
} from "@/modules/ai/openai/client";
import { OpenAICanonicalSummaryProvider } from "@/modules/ai/openai/canonical-summary";
import { OpenAIGroupExtractionProvider } from "@/modules/ai/openai/group-extraction";
import { OpenAITranscriptionProvider } from "@/modules/ai/openai/transcription";
import { OpenAIImageTextExtractionProvider } from "@/modules/ai/openai/vision";
import { SupabaseAttachmentEvidenceRepository } from "@/modules/ai/evidence/repository";
import { createSupabaseAttachmentEvidenceStorage } from "@/modules/ai/evidence/storage";
import { processAttachmentEvidenceBatch } from "@/modules/ai/evidence/worker";
import { BitrixClient } from "@/modules/bitrix/client";
import { assertDiscoveryReady, discoverBitrix } from "@/modules/bitrix/discovery";
import { GraphManagerDirectory } from "@/modules/bitrix/graph-users";
import { BitrixLeads } from "@/modules/bitrix/leads";
import { SupabaseCrmSyncRepository } from "@/modules/bitrix/repository";
import type { BitrixDiscoveryConfiguration } from "@/modules/bitrix/types";
import { BitrixUsers } from "@/modules/bitrix/users";
import { processCrmSync } from "@/modules/bitrix/worker";
import { SupabaseCanonicalizationRepository } from "@/modules/leads/canonicalization/repository";
import { processCanonicalization } from "@/modules/leads/canonicalization/worker";
import { SupabaseGroupExtractionRepository } from "@/modules/leads/extraction/repository";
import { processGroupExtractionBatch } from "@/modules/leads/extraction/worker";
import { SupabaseConversationGroupingRepository } from "@/modules/leads/grouping/repository";
import { runConversationGrouping } from "@/modules/leads/grouping/worker";
import { acquireAttachmentBatch } from "@/modules/teams/attachments/acquire";
import { GraphAttachmentByteSource } from "@/modules/teams/attachments/graph-source";
import { SupabaseAttachmentAcquisitionRepository } from "@/modules/teams/attachments/repository";
import { createSupabaseAttachmentObjectStorage } from "@/modules/teams/attachments/storage";
import { ClientCredentialsTokenProvider } from "@/modules/teams/graph/auth";
import { GraphClient } from "@/modules/teams/graph/client";
import { GraphTeamsReader } from "@/modules/teams/graph/reader";
import { ingestFetchedBatch } from "@/modules/teams/ingestion/ingest-channel";
import { SupabaseTeamsMessageRepository } from "@/modules/teams/ingestion/persist-message";

import {
  WORKER_BATCH_LIMITS,
  WORKER_LEASE_SECONDS,
} from "./config";
import type { PipelineStage } from "./orchestrator";

const STARTUP_CATCHUP_MS = 48 * 60 * 60 * 1_000;
const CATCHUP_OVERLAP_MS = 5 * 60 * 1_000;
const CATCHUP_FUTURE_MARGIN_MS = 5 * 60 * 1_000;

export function createProductionPipelineStages(): PipelineStage[] {
  const environment = requireServerEnvironment([
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MS_TENANT_ID",
    "MS_CLIENT_ID",
    "MS_CLIENT_SECRET",
    "MS_TEAM_NAME",
    "MS_CHANNEL_NAME",
    "OPENAI_API_KEY",
    "BITRIX_WEBHOOK_BASE_URL",
  ] as const);
  const supabase = createSupabaseAdminClient();
  const reader = new GraphTeamsReader({
    tenantId: environment.MS_TENANT_ID,
    clientId: environment.MS_CLIENT_ID,
    clientSecret: environment.MS_CLIENT_SECRET,
  });
  let channel: Awaited<ReturnType<GraphTeamsReader["resolveChannel"]>> | undefined;
  let lastSuccessfulCatchupAt: number | undefined;

  const tokenProvider = new ClientCredentialsTokenProvider({
    tenantId: environment.MS_TENANT_ID,
    clientId: environment.MS_CLIENT_ID,
    clientSecret: environment.MS_CLIENT_SECRET,
  });
  const graphClient = new GraphClient(() => tokenProvider.getAccessToken());
  const openai = createOpenAIClient(environment.OPENAI_API_KEY);
  const bitrixClient = new BitrixClient(environment.BITRIX_WEBHOOK_BASE_URL);
  const bitrixLeads = new BitrixLeads(bitrixClient);
  const crmRepository = new SupabaseCrmSyncRepository(supabase);
  let bitrixDiscovery: BitrixDiscoveryConfiguration | undefined;

  const transcriptionProvider = new OpenAITranscriptionProvider(
    openai,
    environment.OPENAI_TRANSCRIPTION_MODEL ?? DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  );
  const imageProvider = new OpenAIImageTextExtractionProvider(
    openai,
    environment.OPENAI_VISION_MODEL ?? DEFAULT_OPENAI_VISION_MODEL,
  );
  const extractionProvider = new OpenAIGroupExtractionProvider(
    openai,
    environment.OPENAI_EXTRACTION_MODEL ?? DEFAULT_OPENAI_EXTRACTION_MODEL,
  );
  const summaryProvider = new OpenAICanonicalSummaryProvider(
    openai,
    environment.OPENAI_SUMMARY_MODEL ?? DEFAULT_OPENAI_SUMMARY_MODEL,
  );

  return [
    {
      name: "teams_ingestion",
      run: async () => {
        channel ??= await reader.resolveChannel(
          environment.MS_TEAM_NAME,
          environment.MS_CHANNEL_NAME,
        );
        const now = Date.now();
        const since =
          lastSuccessfulCatchupAt === undefined
            ? now - STARTUP_CATCHUP_MS
            : lastSuccessfulCatchupAt - CATCHUP_OVERLAP_MS;
        const batch = await reader.fetchCatchup({
          channel,
          since: new Date(since).toISOString(),
          until: new Date(now + CATCHUP_FUTURE_MARGIN_MS).toISOString(),
          messageLimit: WORKER_BATCH_LIMITS.teamsMessages,
        });
        const summary = await ingestFetchedBatch({
          batch,
          tenantId: environment.MS_TENANT_ID,
          mode: "catch-up",
          dryRun: false,
          repository: new SupabaseTeamsMessageRepository(supabase),
        });
        lastSuccessfulCatchupAt = now;
        return summary;
      },
    },
    {
      name: "attachment_acquisition",
      run: () =>
        acquireAttachmentBatch({
          repository: new SupabaseAttachmentAcquisitionRepository(supabase),
          byteSource: new GraphAttachmentByteSource(
            graphClient,
            environment.MS_TENANT_ID,
          ),
          storage: createSupabaseAttachmentObjectStorage(supabase),
          limit: WORKER_BATCH_LIMITS.attachmentAcquisition,
          leaseSeconds: WORKER_LEASE_SECONDS,
        }),
    },
    {
      name: "attachment_ai_evidence",
      run: () =>
        processAttachmentEvidenceBatch({
          repository: new SupabaseAttachmentEvidenceRepository(supabase),
          storage: createSupabaseAttachmentEvidenceStorage(supabase),
          transcriptionProvider,
          imageProvider,
          limit: WORKER_BATCH_LIMITS.attachmentEvidence,
          leaseSeconds: WORKER_LEASE_SECONDS,
        }),
    },
    {
      name: "conversation_grouping",
      run: () =>
        runConversationGrouping({
          repository: new SupabaseConversationGroupingRepository(supabase),
          limit: WORKER_BATCH_LIMITS.conversationGrouping,
        }),
    },
    {
      name: "group_extraction",
      run: () =>
        processGroupExtractionBatch({
          repository: new SupabaseGroupExtractionRepository(supabase),
          provider: extractionProvider,
          limit: WORKER_BATCH_LIMITS.groupExtraction,
          leaseSeconds: WORKER_LEASE_SECONDS,
        }),
    },
    {
      name: "canonicalization",
      run: () =>
        processCanonicalization({
          repository: new SupabaseCanonicalizationRepository(supabase),
          summaryProvider,
          groupLimit: WORKER_BATCH_LIMITS.canonicalGroups,
          summaryLimit: WORKER_BATCH_LIMITS.canonicalSummaries,
          summaryLeaseSeconds: WORKER_LEASE_SECONDS,
        }),
    },
    {
      name: "bitrix_sync",
      run: async () => {
        if (!bitrixDiscovery) {
          const discovered = await discoverBitrix(bitrixClient);
          assertDiscoveryReady(discovered);
          bitrixDiscovery = discovered;
        }
        return processCrmSync({
          repository: crmRepository,
          teamsDirectory: new GraphManagerDirectory({
            tenantId: environment.MS_TENANT_ID,
            clientId: environment.MS_CLIENT_ID,
            clientSecret: environment.MS_CLIENT_SECRET,
          }),
          bitrixUsers: new BitrixUsers(bitrixClient),
          bitrixLeads,
          discovery: bitrixDiscovery,
          workerId: `production-worker-${process.pid}`,
          limit: WORKER_BATCH_LIMITS.crmOutbox,
          leaseSeconds: WORKER_LEASE_SECONDS,
        });
      },
    },
  ];
}

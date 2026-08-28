import "server-only";

import { BitrixSyncError } from "./errors";
import { buildBitrixLeadFields, buildSourceTimelineComment } from "./mapping";
import type {
  BitrixDiscoveryConfiguration,
  BitrixLeadGateway,
  BitrixUserGateway,
  CrmSyncClaim,
  CrmSyncRepository,
  CrmSyncSummary,
  TeamsManagerDirectory,
} from "./types";

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function retryDelay(attempts: number): number {
  return Math.min(3_600, 60 * 2 ** Math.max(0, attempts - 1));
}

async function safeRecordOutcome(options: {
  repository: CrmSyncRepository;
  claim: CrmSyncClaim;
  error: BitrixSyncError;
  durationMs: number;
}): Promise<void> {
  try {
    await options.repository.recordOutcome({
      claim: options.claim,
      outcome: options.error.outcome,
      errorCode: options.error.code,
      durationMs: options.durationMs,
      retryDelaySeconds: retryDelay(options.claim.attempts),
    });
  } catch {
    // The fenced lease expires and remains reclaimable. Never log source or CRM data.
  }
}

async function resolveManager(options: {
  claim: CrmSyncClaim;
  repository: CrmSyncRepository;
  teamsDirectory: TeamsManagerDirectory;
  bitrixUsers: BitrixUserGateway;
  discovery: BitrixDiscoveryConfiguration;
}): Promise<{ bitrixUserId: number; email: string }> {
  const distinctCachedIds = new Set(
    options.claim.cachedManagerMappings.map((mapping) => mapping.bitrixUserId),
  );
  if (distinctCachedIds.size > 1) {
    throw new BitrixSyncError("MANAGER_MAPPING_AMBIGUOUS", "blocked");
  }
  if (distinctCachedIds.size === 1) {
    const bitrixUserId = [...distinctCachedIds][0]!;
    const email = options.claim.cachedManagerMappings
      .map((mapping) => mapping.email)
      .filter((value): value is string => value !== null)
      .sort()[0];
    const authorField = options.discovery.fields.UF_CRM_TEAMS_AUTHOR;
    if (!email && authorField?.type !== "employee" && authorField?.type !== "user") {
      throw new BitrixSyncError("MANAGER_MAPPING_EMAIL_MISSING", "blocked");
    }
    return { bitrixUserId, email: email ?? "" };
  }

  if (!options.claim.assignedTeamsUserId) {
    throw new BitrixSyncError("MANAGER_MAPPING_MISSING", "blocked");
  }
  const emails = await options.teamsDirectory.resolveEmails(
    options.claim.assignedTeamsUserId,
  );
  if (emails.length === 0) {
    throw new BitrixSyncError("MANAGER_MAPPING_MISSING", "blocked");
  }
  const matches = new Map<number, Set<string>>();
  for (const email of emails) {
    const ids = await options.bitrixUsers.findExactByEmail(email);
    for (const id of ids) {
      const matchedEmails = matches.get(id) ?? new Set<string>();
      matchedEmails.add(email);
      matches.set(id, matchedEmails);
    }
  }
  if (matches.size === 0) {
    throw new BitrixSyncError("MANAGER_MAPPING_MISSING", "blocked");
  }
  if (matches.size > 1) {
    throw new BitrixSyncError("MANAGER_MAPPING_AMBIGUOUS", "blocked");
  }
  const [bitrixUserId, matchedEmails] = [...matches.entries()][0]!;
  const email = [...matchedEmails].sort()[0]!;
  await options.repository.persistManagerMapping({
    teamsUserId: options.claim.assignedTeamsUserId,
    email,
    bitrixUserId,
  });
  return { bitrixUserId, email };
}

export async function processCrmSync(options: {
  repository: CrmSyncRepository;
  teamsDirectory: TeamsManagerDirectory;
  bitrixUsers: BitrixUserGateway;
  bitrixLeads: BitrixLeadGateway;
  discovery: BitrixDiscoveryConfiguration;
  workerId: string;
  limit: number;
  leaseSeconds: number;
}): Promise<CrmSyncSummary> {
  const claims = await options.repository.claim({
    workerId: options.workerId,
    limit: options.limit,
    leaseSeconds: options.leaseSeconds,
  });
  const summary: CrmSyncSummary = {
    outboxSeen: claims.length,
    created: 0,
    updated: 0,
    recovered: 0,
    blocked: 0,
    failed: 0,
  };

  for (const claim of claims) {
    const startedAt = Date.now();
    try {
      const manager = await resolveManager({
        claim,
        repository: options.repository,
        teamsDirectory: options.teamsDirectory,
        bitrixUsers: options.bitrixUsers,
        discovery: options.discovery,
      });
      const fields = buildBitrixLeadFields({
        claim,
        assignedBitrixUserId: manager.bitrixUserId,
        managerEmail: manager.email,
        discovery: options.discovery,
      });

      let bitrixLeadId: number;
      let action: "created" | "updated" | "recovered";
      if (claim.crmCompletedAt !== null) {
        if (claim.outboxBitrixLeadId === null || claim.syncAction === null) {
          throw new BitrixSyncError("CRM_DURABLE_STAGE_INVALID", "permanent_failed");
        }
        bitrixLeadId = claim.outboxBitrixLeadId;
        action = claim.syncAction;
      } else if (claim.localBitrixLeadId !== null) {
        bitrixLeadId = claim.localBitrixLeadId;
        await options.bitrixLeads.update(bitrixLeadId, fields);
        action = "updated";
        await options.repository.completeLeadDelivery({ claim, bitrixLeadId, action });
      } else {
        const remoteMatches = await options.bitrixLeads.lookupBySourceGroup(
          claim.bitrixSourceGroupId,
        );
        if (remoteMatches.length > 1) {
          throw new BitrixSyncError("REMOTE_IDEMPOTENCY_CONFLICT", "blocked");
        }
        if (remoteMatches.length === 1) {
          bitrixLeadId = remoteMatches[0]!;
          await options.bitrixLeads.update(bitrixLeadId, fields);
          action = "recovered";
        } else {
          bitrixLeadId = await options.bitrixLeads.add(fields);
          action = "created";
        }
        await options.repository.completeLeadDelivery({ claim, bitrixLeadId, action });
      }

      const timelineCommentId = await options.bitrixLeads.addSourceComment(
        bitrixLeadId,
        buildSourceTimelineComment(claim),
      );
      await options.repository.complete({
        claim,
        timelineCommentId,
        durationMs: elapsed(startedAt),
      });
      summary[action] += 1;
    } catch (error) {
      const safeError = error instanceof BitrixSyncError
        ? error
        : new BitrixSyncError("BITRIX_SYNC_ERROR", "retryable_failed");
      await safeRecordOutcome({
        repository: options.repository,
        claim,
        error: safeError,
        durationMs: elapsed(startedAt),
      });
      if (safeError.outcome === "blocked") summary.blocked += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}

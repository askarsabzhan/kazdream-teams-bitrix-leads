import "server-only";

import { BitrixSyncError } from "./errors";
import { buildBitrixLeadFields } from "./mapping";
import type {
  BitrixDiscoveryConfiguration,
  BitrixLeadGateway,
  BitrixProtectedChecks,
  CrmSyncClaim,
  CrmSyncRepository,
} from "./types";

function scalar(value: unknown): string {
  return String(value ?? "");
}

function scalarList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(scalar).sort();
  return [scalar(value)];
}

function equivalent(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    const expectedScalars = expected.every(
      (value) => typeof value !== "object" || value === null,
    );
    if (expectedScalars) {
      return JSON.stringify(scalarList(actual)) === JSON.stringify(scalarList(expected));
    }
  }
  return scalar(actual) === scalar(expected);
}

function contactValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("VALUE" in item)) return [];
    return [String(item.VALUE)];
  }).sort();
}

function expectedClaim(target: Awaited<ReturnType<CrmSyncRepository["loadVerificationTargets"]>>[number]): CrmSyncClaim {
  return {
    outboxId: target.leadId,
    leaseId: target.leadId,
    attempts: 1,
    leadId: target.leadId,
    leadRevision: target.leadRevision,
    localBitrixLeadId: target.bitrixLeadId,
    outboxBitrixLeadId: target.bitrixLeadId,
    syncAction: "updated",
    crmCompletedAt: "confirmed",
    sourceCommentState: "succeeded",
    sourceCommentMarker: `[KD-SOURCE:${target.leadId}:r${target.leadRevision}]`,
    bitrixSourceGroupId: target.bitrixSourceGroupId,
    assignedTeamsUserId: null,
    canonicalPayload: target.canonicalPayload,
    summaryRu: target.summaryRu,
    groupIds: target.groupIds,
    teamsMessageIds: target.teamsMessageIds,
    sourceEvidence: [],
    cachedManagerMappings: [],
  };
}

export async function verifyBitrixSync(options: {
  repository: CrmSyncRepository;
  bitrixLeads: BitrixLeadGateway;
  discovery: BitrixDiscoveryConfiguration;
  expectedLeadCount: number;
}): Promise<BitrixProtectedChecks> {
  const targets = await options.repository.loadVerificationTargets();
  const remoteIds = new Set<number>();
  let responsible = true;
  let leadType = true;
  let exhibition = true;
  let source = true;
  let contacts = true;
  let summary = true;
  let sourceComment = true;

  for (const target of targets) {
    const lookup = await options.bitrixLeads.lookupBySourceGroup(
      target.bitrixSourceGroupId,
    );
    if (lookup.length !== 1 || lookup[0] !== target.bitrixLeadId) continue;
    remoteIds.add(target.bitrixLeadId);
    const remote = await options.bitrixLeads.get(target.bitrixLeadId);
    const authorField = options.discovery.fields.UF_CRM_TEAMS_AUTHOR;
    if (
      !target.assignedManagerEmail &&
      authorField?.type !== "employee" &&
      authorField?.type !== "user"
    ) {
      throw new BitrixSyncError("MANAGER_MAPPING_EMAIL_MISSING", "blocked");
    }
    const expected = buildBitrixLeadFields({
      claim: expectedClaim(target),
      assignedBitrixUserId: target.assignedBitrixUserId,
      managerEmail: target.assignedManagerEmail ?? "",
      discovery: options.discovery,
    });
    responsible &&= equivalent(remote.ASSIGNED_BY_ID, expected.ASSIGNED_BY_ID);
    leadType &&= equivalent(remote.UF_CRM_LEAD_TYPE, expected.UF_CRM_LEAD_TYPE);
    exhibition &&= equivalent(remote.UF_CRM_EXHIBITION, expected.UF_CRM_EXHIBITION);
    source &&= equivalent(remote.SOURCE_ID, expected.SOURCE_ID);
    summary &&= equivalent(remote.COMMENTS, expected.COMMENTS);
    sourceComment &&= target.sourceCommentConfirmed;
    contacts &&=
      equivalent(remote.TITLE, expected.TITLE) &&
      equivalent(remote.NAME, expected.NAME) &&
      (expected.COMPANY_TITLE === undefined || equivalent(remote.COMPANY_TITLE, expected.COMPANY_TITLE)) &&
      (expected.POST === undefined || equivalent(remote.POST, expected.POST)) &&
      JSON.stringify(contactValues(remote.PHONE)) === JSON.stringify(contactValues(expected.PHONE)) &&
      JSON.stringify(contactValues(remote.EMAIL)) === JSON.stringify(contactValues(expected.EMAIL)) &&
      equivalent(remote.UF_CRM_TEAMS_GROUP_ID, expected.UF_CRM_TEAMS_GROUP_ID) &&
      equivalent(remote.UF_CRM_TEAMS_MESSAGE_IDS, expected.UF_CRM_TEAMS_MESSAGE_IDS) &&
      equivalent(remote.UF_CRM_TEAMS_AUTHOR, expected.UF_CRM_TEAMS_AUTHOR);
  }

  return {
    BITRIX_LEAD_COUNT_CHECK:
      targets.length === options.expectedLeadCount &&
      remoteIds.size === options.expectedLeadCount,
    BITRIX_RESPONSIBLE_CHECK: responsible && targets.length > 0,
    BITRIX_LEAD_TYPE_CHECK: leadType && targets.length > 0,
    BITRIX_EXHIBITION_CHECK: exhibition && targets.length > 0,
    BITRIX_SOURCE_CHECK: source && targets.length > 0,
    BITRIX_CONTACT_FIELDS_CHECK: contacts && targets.length > 0,
    BITRIX_SUMMARY_CHECK: summary && targets.length > 0,
    BITRIX_SOURCE_COMMENT_CHECK: sourceComment && targets.length > 0,
  };
}

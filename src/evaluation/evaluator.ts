import type { RawGroupExtraction } from "../modules/leads/extraction/schema";
import type { GroupEvidenceItem, GroupCandidatePayload } from "../modules/leads/extraction/types";
import { validateGroupExtraction } from "../modules/leads/extraction/validation";
import {
  composeCanonicalLead,
  resolveCanonicalMatch,
  type ExistingCanonicalIdentity,
} from "../modules/leads/canonicalization/composition";
import type { EligibleCanonicalGroup } from "../modules/leads/canonicalization/types";
import { groupConversationMessages } from "../modules/leads/grouping/engine";
import {
  extractGroupingSignals,
  normalizeEmail,
  normalizePhone,
} from "../modules/leads/grouping/signals";

import { SYNTHETIC_MESSAGES } from "./dataset";
import {
  CANONICAL_GROUND_TRUTH,
  ENCOUNTER_GROUND_TRUTH,
  EXPECTED_AMBIGUOUS_MESSAGE_COUNT,
  EXPECTED_MESSAGE_COUNT,
} from "./ground-truth";
import type { EvaluationMetrics, ReplayMetrics, SyntheticMessage } from "./types";

interface EvaluatedGroup {
  group: EligibleCanonicalGroup;
  encounterId: string;
  evidence: GroupEvidenceItem[];
}

interface CanonicalState {
  id: string;
  groups: EligibleCanonicalGroup[];
  identity: ExistingCanonicalIdentity;
  responsibleManagerId: string | null;
}

interface PersistenceState {
  messages: Set<string>;
  memberships: Set<string>;
  groups: Set<string>;
  canonicalLeads: Set<string>;
  crmIntents: Set<string>;
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function rate(correct: number, total: number): number {
  return total === 0 ? 1 : roundMetric(correct / total);
}

function labelEntries(
  evidence: readonly GroupEvidenceItem[],
  label: string,
): Array<{ value: string; evidenceId: string }> {
  const pattern = new RegExp(`(?:^|\\n)${label}:\\s*([^\\n]+)`, "giu");
  return evidence.flatMap((item) =>
    [...item.text.matchAll(pattern)].flatMap((match) => {
      const value = match[1]?.trim();
      return value ? [{ value, evidenceId: item.id }] : [];
    }),
  );
}

function rawField(
  entries: Array<{ value: string; evidenceId: string }>,
): RawGroupExtraction["person"]["full_name"] {
  const values = new Map<string, { value: string; evidenceIds: string[] }>();
  for (const entry of entries) {
    const key = entry.value.normalize("NFKC").toLocaleLowerCase("und").trim();
    const current = values.get(key);
    if (current) current.evidenceIds.push(entry.evidenceId);
    else values.set(key, { value: entry.value, evidenceIds: [entry.evidenceId] });
  }
  if (values.size === 0) return { value: null, evidence_ids: [], status: "uncertain" };
  if (values.size > 1) {
    return {
      value: null,
      evidence_ids: [...new Set([...values.values()].flatMap((item) => item.evidenceIds))],
      status: "conflicted",
    };
  }
  const only = [...values.values()][0]!;
  return { value: only.value, evidence_ids: [...new Set(only.evidenceIds)], status: "supported" };
}

function signalValues(
  evidence: readonly GroupEvidenceItem[],
  kind: "phone" | "email",
): Array<{ value: string; evidence_ids: string[] }> {
  const values = new Map<string, string[]>();
  for (const item of evidence) {
    const signals = extractGroupingSignals([item.text]);
    const selected = kind === "phone" ? signals.phones : signals.emails;
    for (const value of selected) {
      const ids = values.get(value) ?? [];
      ids.push(item.id);
      values.set(value, ids);
    }
  }
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, evidenceIds]) => ({ value, evidence_ids: [...new Set(evidenceIds)] }));
}

function citedTerms(
  evidence: readonly GroupEvidenceItem[],
  terms: readonly string[],
): Array<{ value: string; evidence_ids: string[] }> {
  return evidence.flatMap((item) => {
    const lower = item.text.toLocaleLowerCase("und");
    const term = terms.find((candidate) => lower.includes(candidate.toLocaleLowerCase("und")));
    return term ? [{ value: term, evidence_ids: [item.id] }] : [];
  });
}

function deriveRawExtraction(evidence: readonly GroupEvidenceItem[]): RawGroupExtraction {
  const regionEvidence = evidence.filter((item) => /\b(?:Europe|Germany|Hannover)\b/iu.test(item.text));
  const priorityEvidence = evidence.filter((item) => /\b(?:urgent|priority|asap)\b/iu.test(item.text));
  return {
    person: {
      full_name: rawField(labelEntries(evidence, "Name")),
      company: rawField(labelEntries(evidence, "Company")),
      job_title: rawField(labelEntries(evidence, "Role")),
    },
    phones: signalValues(evidence, "phone"),
    emails: signalValues(evidence, "email"),
    relationship_indicators: citedTerms(evidence, ["system integrator", "partner", "customer"]),
    product_interests: citedTerms(evidence, [
      "Platform/Core",
      "Analytics",
      "Integration Services",
      "Support & SLA",
      "Training",
      "OEM/White label",
    ]),
    region: regionEvidence.length > 0
      ? { value: "Europe", evidence_ids: regionEvidence.map((item) => item.id), status: "supported" }
      : { value: null, evidence_ids: [], status: "uncertain" },
    priority: priorityEvidence.length > 0
      ? { value: "High", evidence_ids: priorityEvidence.map((item) => item.id), status: "supported" }
      : { value: null, evidence_ids: [], status: "uncertain" },
    facts: [],
  };
}

function evidenceFor(messages: readonly SyntheticMessage[]): GroupEvidenceItem[] {
  const evidence: GroupEvidenceItem[] = [];
  for (const message of messages) {
    if (message.bodyContent) {
      evidence.push({
        id: `msg:${message.sequence}:text`,
        type: message.replyToExternalMessageId ? "reply_text" : "teams_text",
        teamsMessageId: message.id,
        attachmentId: null,
        text: message.bodyContent,
      });
    }
    for (const attachment of message.attachments) {
      if (
        attachment.fetchState === "fetched" &&
        attachment.processingState === "processed" &&
        attachment.operation === "transcription" &&
        attachment.transcriptText
      ) {
        evidence.push({
          id: `att:${attachment.fixtureId}:transcript`,
          type: "transcript",
          teamsMessageId: message.id,
          attachmentId: `attachment-${attachment.fixtureId}`,
          text: attachment.transcriptText,
        });
      }
      if (
        attachment.fetchState === "fetched" &&
        attachment.processingState === "processed" &&
        attachment.operation === "image_text" &&
        attachment.ocrText
      ) {
        evidence.push({
          id: `att:${attachment.fixtureId}:ocr`,
          type: "ocr",
          teamsMessageId: message.id,
          attachmentId: `attachment-${attachment.fixtureId}`,
          text: attachment.ocrText,
        });
      }
    }
  }
  return evidence;
}

function latestManager(groups: readonly EligibleCanonicalGroup[]): string | null {
  return groups
    .flatMap((group) => group.contributors)
    .filter((contributor) => contributor.authorTeamsUserId !== null)
    .sort((left, right) =>
      `${right.sourceCreatedAt}:${right.teamsMessageId}`.localeCompare(
        `${left.sourceCreatedAt}:${left.teamsMessageId}`,
      ),
    )[0]?.authorTeamsUserId ?? null;
}

function identityFor(id: string, groups: readonly EligibleCanonicalGroup[]): ExistingCanonicalIdentity {
  const composition = composeCanonicalLead(groups);
  return {
    leadId: id,
    identityKeys: composition.identityKeys,
    nameKey: composition.nameKey,
    companyKey: composition.companyKey,
  };
}

function buildCanonicalStates(groups: readonly EvaluatedGroup[]): {
  states: CanonicalState[];
  groupToLead: Map<string, string>;
} {
  const states: CanonicalState[] = [];
  const groupToLead = new Map<string, string>();
  const ordered = [...groups].sort((left, right) =>
    left.group.contributors[0]!.sourceCreatedAt.localeCompare(
      right.group.contributors[0]!.sourceCreatedAt,
    ),
  );
  for (const evaluated of ordered) {
    const decision = resolveCanonicalMatch(
      evaluated.group,
      states.map((state) => state.identity),
    );
    if (decision.state === "identity_conflict") continue;
    if (decision.state === "create") {
      const id = `actual-lead-${String(states.length + 1).padStart(2, "0")}`;
      const leadGroups = [evaluated.group];
      states.push({
        id,
        groups: leadGroups,
        identity: identityFor(id, leadGroups),
        responsibleManagerId: latestManager(leadGroups),
      });
      groupToLead.set(evaluated.group.groupId, id);
      continue;
    }
    const state = states.find((candidate) => candidate.id === decision.leadId);
    if (!state) throw new Error("Evaluation canonical match target is missing.");
    state.groups.push(evaluated.group);
    state.identity = identityFor(state.id, state.groups);
    state.responsibleManagerId = latestManager(state.groups);
    groupToLead.set(evaluated.group.groupId, state.id);
  }
  return { states, groupToLead };
}

function attemptPersistence(options: {
  state: PersistenceState;
  messages: readonly SyntheticMessage[];
  groupMessages: ReadonlyMap<string, readonly SyntheticMessage[]>;
  canonicalStates: readonly CanonicalState[];
}): EvaluationMetrics["firstRunWrites"] {
  const writes = { messages: 0, memberships: 0, groups: 0, canonicalLeads: 0, crmIntents: 0 };
  for (const message of options.messages) {
    if (!options.state.messages.has(message.externalMessageId)) {
      options.state.messages.add(message.externalMessageId);
      writes.messages += 1;
    }
  }
  for (const [groupId, messages] of options.groupMessages) {
    if (!options.state.groups.has(groupId)) {
      options.state.groups.add(groupId);
      writes.groups += 1;
    }
    for (const message of messages) {
      const key = `${groupId}:${message.externalMessageId}`;
      if (!options.state.memberships.has(key)) {
        options.state.memberships.add(key);
        writes.memberships += 1;
      }
    }
  }
  for (const lead of options.canonicalStates) {
    const signature = lead.groups.map((group) => group.groupId).sort().join("|");
    if (!options.state.canonicalLeads.has(signature)) {
      options.state.canonicalLeads.add(signature);
      writes.canonicalLeads += 1;
    }
    const crmKey = `${signature}:revision:1`;
    if (!options.state.crmIntents.has(crmKey)) {
      options.state.crmIntents.add(crmKey);
      writes.crmIntents += 1;
    }
  }
  return writes;
}

function contactIsSupported(candidate: GroupCandidatePayload, evidence: readonly GroupEvidenceItem[]): number {
  let hallucinations = 0;
  const allText = evidence.map((item) => item.text.normalize("NFKC").toLocaleLowerCase("und"));
  if (
    candidate.person.fullName.value &&
    !allText.some((text) => text.includes(candidate.person.fullName.value!.toLocaleLowerCase("und")))
  ) hallucinations += 1;
  for (const phone of candidate.phones) {
    const normalized = normalizePhone(phone.value);
    if (!normalized || !evidence.some((item) => extractGroupingSignals([item.text]).phones.has(normalized))) {
      hallucinations += 1;
    }
  }
  for (const email of candidate.emails) {
    const normalized = normalizeEmail(email.value);
    if (!normalized || !evidence.some((item) => extractGroupingSignals([item.text]).emails.has(normalized))) {
      hallucinations += 1;
    }
  }
  return hallucinations;
}

export function runSyntheticEvaluation(): EvaluationMetrics {
  if (SYNTHETIC_MESSAGES.length !== EXPECTED_MESSAGE_COUNT) {
    throw new Error("Synthetic evaluation message count changed unexpectedly.");
  }
  const decisions = groupConversationMessages(SYNTHETIC_MESSAGES);
  const messageById = new Map(SYNTHETIC_MESSAGES.map((message) => [message.id, message]));
  const groupedMessages = new Map<string, SyntheticMessage[]>();
  for (const decision of decisions) {
    if (decision.state !== "grouped" || decision.groupKey === null) continue;
    const message = messageById.get(decision.messageId);
    if (!message) throw new Error("Evaluation grouping returned an unknown message.");
    const members = groupedMessages.get(decision.groupKey) ?? [];
    members.push(message);
    groupedMessages.set(decision.groupKey, members);
  }

  const evaluatedGroups: EvaluatedGroup[] = [];
  for (const [groupId, messages] of groupedMessages) {
    const encounterIds = [...new Set(messages.map((message) => message.encounterId).filter(Boolean))];
    if (encounterIds.length !== 1) continue;
    const encounterId = encounterIds[0]!;
    const evidence = evidenceFor(messages);
    const extraction = validateGroupExtraction(deriveRawExtraction(evidence), evidence);
    evaluatedGroups.push({
      encounterId,
      evidence,
      group: {
        groupId,
        leadId: null,
        candidateSourceFingerprint: `evaluation:${groupId}`,
        candidate: extraction.candidate,
        contributors: messages.map((message) => ({
          teamsMessageId: message.id,
          authorTeamsUserId: message.authorTeamsUserId,
          sourceCreatedAt: message.sourceCreatedAt,
        })),
      },
    });
  }

  const truthByEncounter = new Map(
    ENCOUNTER_GROUND_TRUTH.map((truth) => [truth.encounterId, truth]),
  );
  const eligibleGroups = evaluatedGroups.filter(
    (evaluated) => evaluated.group.candidate.eligibility.state === "eligible",
  );
  const canonical = buildCanonicalStates(eligibleGroups);
  const expectedCanonicalByGroup = new Map<string, string>();
  for (const evaluated of eligibleGroups) {
    const truth = truthByEncounter.get(evaluated.encounterId);
    if (truth?.canonicalId) expectedCanonicalByGroup.set(evaluated.group.groupId, truth.canonicalId);
  }

  let falseMerges = 0;
  for (const state of canonical.states) {
    const expected = new Set(
      state.groups.map((group) => expectedCanonicalByGroup.get(group.groupId)).filter(Boolean),
    );
    falseMerges += Math.max(0, expected.size - 1);
  }
  let falseSplits = 0;
  for (const truth of CANONICAL_GROUND_TRUTH) {
    const actual = new Set<string>();
    for (const [groupId, canonicalId] of expectedCanonicalByGroup) {
      if (canonicalId !== truth.canonicalId) continue;
      const actualLeadId = canonical.groupToLead.get(groupId);
      if (actualLeadId) actual.add(actualLeadId);
    }
    falseSplits += Math.max(0, actual.size - 1);
  }

  let eligibilityCorrect = 0;
  let leadTypeCorrect = 0;
  let contactCorrect = 0;
  let contactChecks = 0;
  let hallucinatedContactValues = 0;
  for (const evaluated of evaluatedGroups) {
    const truth = truthByEncounter.get(evaluated.encounterId);
    if (!truth) continue;
    const candidate = evaluated.group.candidate;
    eligibilityCorrect += Number((candidate.eligibility.state === "eligible") === truth.eligible);
    leadTypeCorrect += Number(candidate.leadType.value === truth.leadType);
    contactCorrect += Number(candidate.person.fullName.status === truth.fullNameStatus);
    contactCorrect += Number(candidate.phones.length === truth.phoneCount);
    contactCorrect += Number(candidate.emails.length === truth.emailCount);
    contactChecks += 3;
    hallucinatedContactValues += contactIsSupported(candidate, evaluated.evidence);
  }

  let managerCorrect = 0;
  for (const truth of CANONICAL_GROUND_TRUTH) {
    const actualState = canonical.states.find((state) =>
      state.groups.some((group) => expectedCanonicalByGroup.get(group.groupId) === truth.canonicalId),
    );
    managerCorrect += Number(actualState?.responsibleManagerId === truth.responsibleManagerId);
  }

  const eligibleEncounterIds = ENCOUNTER_GROUND_TRUTH
    .filter((truth) => truth.eligible)
    .map((truth) => truth.encounterId);
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (let leftIndex = 0; leftIndex < eligibleEncounterIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligibleEncounterIds.length; rightIndex += 1) {
      const leftId = eligibleEncounterIds[leftIndex]!;
      const rightId = eligibleEncounterIds[rightIndex]!;
      const leftTruth = truthByEncounter.get(leftId)!;
      const rightTruth = truthByEncounter.get(rightId)!;
      const leftGroup = eligibleGroups.find((item) => item.encounterId === leftId)?.group.groupId;
      const rightGroup = eligibleGroups.find((item) => item.encounterId === rightId)?.group.groupId;
      const expectedSame = leftTruth.canonicalId === rightTruth.canonicalId;
      const actualSame = Boolean(
        leftGroup && rightGroup && canonical.groupToLead.get(leftGroup) === canonical.groupToLead.get(rightGroup),
      );
      if (expectedSame && actualSame) truePositive += 1;
      else if (!expectedSame && actualSame) falsePositive += 1;
      else if (expectedSame && !actualSame) falseNegative += 1;
    }
  }
  const precision = rate(truePositive, truePositive + falsePositive);
  const recall = rate(truePositive, truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : roundMetric((2 * precision * recall) / (precision + recall));

  const ambiguousDecisions = decisions.filter((decision) => decision.state === "ambiguous");
  const conflict = evaluatedGroups.find((group) => group.encounterId === "ineligible-name-conflict");
  const ambiguousCorrect =
    Number(ambiguousDecisions.length === EXPECTED_AMBIGUOUS_MESSAGE_COUNT) +
    Number(conflict?.group.candidate.person.fullName.status === "conflicted") +
    Number(conflict?.group.candidate.eligibility.state === "not_eligible");

  const state: PersistenceState = {
    messages: new Set(),
    memberships: new Set(),
    groups: new Set(),
    canonicalLeads: new Set(),
    crmIntents: new Set(),
  };
  const firstRunWrites = attemptPersistence({
    state,
    messages: SYNTHETIC_MESSAGES,
    groupMessages: groupedMessages,
    canonicalStates: canonical.states,
  });
  const replayWrites = attemptPersistence({
    state,
    messages: SYNTHETIC_MESSAGES,
    groupMessages: groupedMessages,
    canonicalStates: canonical.states,
  });
  const replay: ReplayMetrics = {
    duplicateMessages: replayWrites.messages,
    duplicateMemberships: replayWrites.memberships,
    duplicateGroups: replayWrites.groups,
    duplicateCanonicalLeads: replayWrites.canonicalLeads,
    duplicateCrmIntents: replayWrites.crmIntents,
  };

  const byEncounter = new Map(evaluatedGroups.map((item) => [item.encounterId, item]));
  const sameLead = (left: string, right: string): boolean => {
    const leftGroup = byEncounter.get(left)?.group.groupId;
    const rightGroup = byEncounter.get(right)?.group.groupId;
    return Boolean(leftGroup && rightGroup && canonical.groupToLead.get(leftGroup) === canonical.groupToLead.get(rightGroup));
  };
  const differentGroups = (ids: readonly string[]): boolean =>
    new Set(ids.map((id) => byEncounter.get(id)?.group.groupId)).size === ids.length;
  const edgeCases = [
    byEncounter.get("enc-01")?.group.candidate.eligibility.state === "eligible",
    groupedMessages.get(byEncounter.get("enc-02")?.group.groupId ?? "")?.length === 3,
    byEncounter.get("enc-03")?.group.candidate.person.company.status === "supported",
    differentGroups(["enc-04", "enc-05", "enc-06"]),
    differentGroups(["enc-07-a", "enc-07-b"]) && sameLead("enc-07-a", "enc-07-b"),
    byEncounter.get("enc-08")?.group.candidate.phones.length === 2,
    byEncounter.get("enc-09")?.group.candidate.emails.length === 2,
    byEncounter.get("enc-10")?.group.candidate.emails.some((item) => item.value.endsWith(".corn")),
    byEncounter.get("enc-11")?.group.candidate.eligibility.state === "eligible",
    byEncounter.get("ineligible-email-only")?.group.candidate.eligibility.reasonCode === "MISSING_PHONE",
    byEncounter.get("ineligible-missing-name")?.group.candidate.eligibility.reasonCode === "MISSING_FULL_NAME",
    byEncounter.get("enc-12")?.group.candidate.leadType.value === "Partner",
    byEncounter.get("enc-13")?.group.candidate.leadType.reason === "CUSTOMER_DEFAULT",
    byEncounter.get("enc-14")?.group.candidate.leadType.reason === "EXPLICIT_CUSTOMER_INDICATOR",
    conflict?.group.candidate.person.fullName.status === "conflicted",
    sameLead("enc-15-a", "enc-15-b"),
    groupedMessages.get(byEncounter.get("enc-16")?.group.groupId ?? "")?.length === 2,
    ambiguousDecisions.some((decision) => decision.messageId === "message-059"),
    ambiguousDecisions.some((decision) => decision.messageId === "message-060"),
    byEncounter.get("enc-17")?.group.candidate.eligibility.state === "eligible",
    byEncounter.get("enc-18")?.evidence.some((item) => item.type === "transcript"),
    byEncounter.get("enc-19")?.evidence.some((item) => item.type === "ocr"),
    canonical.states.find((lead) => lead.groups.some((group) => expectedCanonicalByGroup.get(group.groupId) === "canonical-20"))?.responsibleManagerId === "manager-f",
    Object.values(replay).every((value) => value === 0),
  ];

  return {
    mode: "DETERMINISTIC_PIPELINE_METRICS",
    messageCount: SYNTHETIC_MESSAGES.length,
    expectedCanonicalLeads: CANONICAL_GROUND_TRUTH.length,
    actualCanonicalLeads: canonical.states.length,
    leadCountAccuracy: rate(
      CANONICAL_GROUND_TRUTH.length - Math.abs(canonical.states.length - CANONICAL_GROUND_TRUTH.length),
      CANONICAL_GROUND_TRUTH.length,
    ),
    falseMerges,
    falseSplits,
    duplicateCanonicalLeads: falseSplits,
    eligibilityAccuracy: rate(eligibilityCorrect, ENCOUNTER_GROUND_TRUTH.length),
    partnerCustomerAccuracy: rate(leadTypeCorrect, ENCOUNTER_GROUND_TRUTH.length),
    responsibleManagerAccuracy: rate(managerCorrect, CANONICAL_GROUND_TRUTH.length),
    requiredContactFieldAccuracy: rate(contactCorrect, contactChecks),
    hallucinatedContactValues,
    ambiguousCaseAccuracy: rate(ambiguousCorrect, 3),
    precision,
    recall,
    f1,
    replay,
    firstRunWrites,
    edgeCasesPassed: edgeCases.filter(Boolean).length,
    edgeCasesTotal: edgeCases.length,
    aiRequests: 0,
  };
}

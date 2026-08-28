import {
  extractGroupingSignals,
  hasStrongIdentity,
  mergeGroupingSignals,
  sharedSignalReason,
  type GroupingSignals,
} from "./signals";
import {
  GROUPING_ALGORITHM_VERSION,
  type GroupableMessage,
  type GroupingDecision,
  type GroupingDecisionReason,
} from "./types";

interface MessageUnit {
  anchor: GroupableMessage;
  messages: GroupableMessage[];
  explicitThread: boolean;
}

interface RuntimeGroup {
  key: string;
  ownerTeamsUserId: string;
  signals: GroupingSignals;
}

function scopeKey(message: GroupableMessage): string {
  return [
    message.source,
    message.tenantId,
    message.teamId,
    message.channelId,
  ].join("\u001f");
}

function externalKey(message: GroupableMessage, externalId: string): string {
  return `${scopeKey(message)}\u001f${externalId}`;
}

function compareMessages(left: GroupableMessage, right: GroupableMessage): number {
  const time = Date.parse(left.sourceCreatedAt) - Date.parse(right.sourceCreatedAt);
  return time || left.id.localeCompare(right.id);
}

function buildUnits(messages: readonly GroupableMessage[]): MessageUnit[] {
  const sorted = [...messages].sort(compareMessages);
  const roots = new Map<string, GroupableMessage>();
  for (const message of sorted) {
    if (!message.replyToExternalMessageId) {
      roots.set(externalKey(message, message.externalMessageId), message);
    }
  }
  const units = new Map<string, MessageUnit>();
  for (const message of sorted) {
    const root = message.replyToExternalMessageId
      ? roots.get(externalKey(message, message.replyToExternalMessageId))
      : message;
    const anchor = root ?? message;
    const unit = units.get(anchor.id) ?? {
      anchor,
      messages: [],
      explicitThread: false,
    };
    unit.messages.push(message);
    unit.explicitThread ||= Boolean(root && message.replyToExternalMessageId);
    units.set(anchor.id, unit);
  }
  return [...units.values()]
    .map((unit) => ({
      ...unit,
      messages: unit.messages.sort(compareMessages),
    }))
    .sort((left, right) => compareMessages(left.anchor, right.anchor));
}

function evidenceTexts(message: GroupableMessage): string[] {
  const texts = message.bodyContent ? [message.bodyContent] : [];
  for (const attachment of message.attachments) {
    if (
      attachment.fetchState !== "fetched" ||
      attachment.processingState !== "processed"
    ) {
      continue;
    }
    if (attachment.operation === "transcription" && attachment.transcriptText) {
      texts.push(attachment.transcriptText);
    } else if (attachment.operation === "image_text" && attachment.ocrText) {
      texts.push(attachment.ocrText);
    }
  }
  return texts;
}

export function signalsForMessage(message: GroupableMessage): GroupingSignals {
  return extractGroupingSignals(evidenceTexts(message));
}

function reasonScore(reason: GroupingDecisionReason): number {
  if (reason === "explicit_reply") return 100;
  if (reason === "exact_email" || reason === "exact_phone") return 100;
  if (reason === "name_company") return 80;
  if (reason === "new_distinct_identity") return 70;
  return 0;
}

function candidateMatches(
  groups: readonly RuntimeGroup[],
  ownerTeamsUserId: string,
  signals: GroupingSignals,
): Array<{ group: RuntimeGroup; reason: GroupingDecisionReason; score: number }> {
  const matches: Array<{
    group: RuntimeGroup;
    reason: GroupingDecisionReason;
    score: number;
  }> = [];
  for (const group of groups) {
    if (group.ownerTeamsUserId !== ownerTeamsUserId) continue;
    const reason = sharedSignalReason(group.signals, signals);
    if (reason) matches.push({ group, reason, score: reasonScore(reason) });
  }
  return matches.sort(
    (left, right) =>
      right.score - left.score || left.group.key.localeCompare(right.group.key),
  );
}

function ambiguousDecision(message: GroupableMessage): GroupingDecision {
  return {
    messageId: message.id,
    sourceFingerprint: message.inputFingerprint,
    state: "ambiguous",
    groupKey: null,
    ownerTeamsUserId: null,
    reason: "ambiguous_unassigned",
    score: 0,
  };
}

function deferredDecision(message: GroupableMessage): GroupingDecision {
  return {
    messageId: message.id,
    sourceFingerprint: message.inputFingerprint,
    state: "deferred",
    groupKey: null,
    ownerTeamsUserId: null,
    reason: "evidence_pending",
    score: 0,
  };
}

export function groupConversationMessages(
  messages: readonly GroupableMessage[],
): GroupingDecision[] {
  const decisions: GroupingDecision[] = [];
  const groups: RuntimeGroup[] = [];

  for (const unit of buildUnits(messages)) {
    const terminalMessages = unit.messages.filter(
      (message) => message.evidenceReady,
    );
    const readyMessages = terminalMessages.filter(
      (message) => !message.isBot && !message.isServiceMessage,
    );
    const nonManagerMessages = terminalMessages.filter(
      (message) => message.isBot || message.isServiceMessage,
    );
    const deferredMessages = unit.messages.filter(
      (message) => !message.evidenceReady,
    );
    decisions.push(...deferredMessages.map(deferredDecision));
    decisions.push(...nonManagerMessages.map(ambiguousDecision));
    if (readyMessages.length === 0) continue;

    const ownerTeamsUserId =
      unit.anchor.authorTeamsUserId ??
      readyMessages.find((message) => message.authorTeamsUserId)
        ?.authorTeamsUserId ??
      null;
    const unitSignals = extractGroupingSignals([]);
    for (const message of readyMessages) {
      mergeGroupingSignals(unitSignals, signalsForMessage(message));
    }

    if (!ownerTeamsUserId) {
      decisions.push(...readyMessages.map(ambiguousDecision));
      continue;
    }

    const matches = candidateMatches(groups, ownerTeamsUserId, unitSignals);
    const strongestScore = matches[0]?.score ?? 0;
    const strongest = matches.filter((match) => match.score === strongestScore);
    const hasConflictingMatches = strongest.length > 1;
    let target: RuntimeGroup | null = null;
    let rootReason: GroupingDecisionReason = "new_distinct_identity";

    if (strongest.length === 1) {
      target = strongest[0]?.group ?? null;
      rootReason = strongest[0]?.reason ?? rootReason;
    } else if (hasConflictingMatches && !unit.explicitThread) {
      decisions.push(...readyMessages.map(ambiguousDecision));
      continue;
    } else if (!unit.explicitThread && !hasStrongIdentity(unitSignals)) {
      decisions.push(...readyMessages.map(ambiguousDecision));
      continue;
    }

    if (!target) {
      target = {
        key: `encounter:${unit.anchor.id}`,
        ownerTeamsUserId,
        signals: extractGroupingSignals([]),
      };
      groups.push(target);
    }
    mergeGroupingSignals(target.signals, unitSignals);

    for (const message of readyMessages) {
      const isExplicitReply = Boolean(message.replyToExternalMessageId);
      const reason = isExplicitReply ? "explicit_reply" : rootReason;
      decisions.push({
        messageId: message.id,
        sourceFingerprint: message.inputFingerprint,
        state: "grouped",
        groupKey: target.key,
        ownerTeamsUserId,
        reason,
        score: reasonScore(reason),
      });
    }
  }

  return decisions.sort((left, right) =>
    left.messageId.localeCompare(right.messageId),
  );
}

export function groupingNeedsReassessment(options: {
  currentAlgorithmVersion: string | null;
  currentSourceFingerprint: string | null;
  nextAlgorithmVersion?: string;
  nextSourceFingerprint: string;
}): boolean {
  return (
    options.currentAlgorithmVersion !==
      (options.nextAlgorithmVersion ?? GROUPING_ALGORITHM_VERSION) ||
    options.currentSourceFingerprint !== options.nextSourceFingerprint
  );
}

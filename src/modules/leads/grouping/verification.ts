import { hasStrongIdentity, sharedSignalReason } from "./signals";
import { signalsForMessage } from "./engine";
import type {
  GroupableMessage,
  GroupingDecision,
  GroupingProtectedChecks,
} from "./types";

function decisionMap(decisions: readonly GroupingDecision[]) {
  return new Map(decisions.map((decision) => [decision.messageId, decision]));
}

function sourceScope(message: GroupableMessage): string {
  return [
    message.source,
    message.tenantId,
    message.teamId,
    message.channelId,
  ].join("\u001f");
}

function rootReplyCheck(
  messages: readonly GroupableMessage[],
  decisions: ReadonlyMap<string, GroupingDecision>,
): boolean {
  const roots = new Map(
    messages
      .filter((message) => !message.replyToExternalMessageId)
      .map((message) => [
        `${sourceScope(message)}\u001f${message.externalMessageId}`,
        message,
      ]),
  );
  const replies = messages.filter((message) => message.replyToExternalMessageId);
  return (
    replies.length > 0 &&
    replies.every((reply) => {
      const root = roots.get(
        `${sourceScope(reply)}\u001f${reply.replyToExternalMessageId}`,
      );
      const replyDecision = decisions.get(reply.id);
      const rootDecision = root ? decisions.get(root.id) : undefined;
      return Boolean(
        rootDecision?.state === "grouped" &&
          replyDecision?.state === "grouped" &&
          rootDecision.groupKey === replyDecision.groupKey,
      );
    })
  );
}

function hasProcessedOperation(
  message: GroupableMessage,
  operation: "transcription" | "image_text",
): boolean {
  return message.attachments.some(
    (attachment) =>
      attachment.fetchState === "fetched" &&
      attachment.processingState === "processed" &&
      attachment.operation === operation,
  );
}

function photoAudioCheck(
  messages: readonly GroupableMessage[],
  decisions: ReadonlyMap<string, GroupingDecision>,
): boolean {
  const images = messages.filter((message) =>
    hasProcessedOperation(message, "image_text"),
  );
  const audio = messages.filter((message) =>
    hasProcessedOperation(message, "transcription"),
  );
  for (const image of images) {
    for (const recording of audio) {
      if (
        image.id === recording.id ||
        !image.authorTeamsUserId ||
        image.authorTeamsUserId !== recording.authorTeamsUserId ||
        !sharedSignalReason(
          signalsForMessage(image),
          signalsForMessage(recording),
        )
      ) {
        continue;
      }
      const imageDecision = decisions.get(image.id);
      const audioDecision = decisions.get(recording.id);
      if (
        imageDecision?.state === "grouped" &&
        audioDecision?.state === "grouped" &&
        imageDecision.groupKey === audioDecision.groupKey
      ) {
        return true;
      }
    }
  }
  return false;
}

function distinctContactsCheck(
  messages: readonly GroupableMessage[],
  decisions: ReadonlyMap<string, GroupingDecision>,
): boolean {
  const roots = messages.filter(
    (message) =>
      !message.replyToExternalMessageId &&
      message.evidenceReady &&
      message.authorTeamsUserId,
  );
  let distinctPairObserved = false;
  for (let first = 0; first < roots.length; first += 1) {
    for (let second = first + 1; second < roots.length; second += 1) {
      const left = roots[first];
      const right = roots[second];
      if (
        !left ||
        !right ||
        left.authorTeamsUserId !== right.authorTeamsUserId
      ) {
        continue;
      }
      const leftSignals = signalsForMessage(left);
      const rightSignals = signalsForMessage(right);
      if (
        !hasStrongIdentity(leftSignals) ||
        !hasStrongIdentity(rightSignals) ||
        sharedSignalReason(leftSignals, rightSignals)
      ) {
        continue;
      }
      distinctPairObserved = true;
      const leftDecision = decisions.get(left.id);
      const rightDecision = decisions.get(right.id);
      if (
        leftDecision?.state !== "grouped" ||
        rightDecision?.state !== "grouped" ||
        leftDecision.groupKey === rightDecision.groupKey
      ) {
        return false;
      }
    }
  }
  return distinctPairObserved;
}

export function evaluateProtectedGroupingChecks(
  messages: readonly GroupableMessage[],
  groupingDecisions: readonly GroupingDecision[],
): GroupingProtectedChecks {
  const decisions = decisionMap(groupingDecisions);
  return {
    rootReply: rootReplyCheck(messages, decisions),
    photoAudio: photoAudioCheck(messages, decisions),
    distinctContactsNotMerged: distinctContactsCheck(messages, decisions),
  };
}

import "server-only";

import type { ConversationGroupingSummary } from "./types";

function pass(value: boolean): "PASS" | "FAIL" {
  return value ? "PASS" : "FAIL";
}

export function formatConversationGroupingSummary(
  summary: ConversationGroupingSummary,
): string {
  return [
    "CONVERSATION_GROUPING_SUMMARY",
    `messages_considered=${summary.messagesConsidered}`,
    `groups_created=${summary.groupsCreated}`,
    `memberships_created=${summary.membershipsCreated}`,
    `memberships_removed=${summary.membershipsRemoved}`,
    `revisions_created=${summary.revisionsCreated}`,
    `ambiguous=${summary.ambiguous}`,
    `deferred=${summary.deferred}`,
    `unchanged=${summary.unchanged}`,
    `openai_requests=${summary.openaiRequests}`,
    `ROOT_REPLY_GROUP_CHECK=${pass(summary.checks.rootReply)}`,
    `PHOTO_AUDIO_GROUP_CHECK=${pass(summary.checks.photoAudio)}`,
    `DISTINCT_CONTACTS_NOT_MERGED_CHECK=${pass(
      summary.checks.distinctContactsNotMerged,
    )}`,
  ].join("\n");
}

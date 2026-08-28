import "server-only";

import { groupConversationMessages } from "./engine";
import { evaluateProtectedGroupingChecks } from "./verification";
import {
  GROUPING_ALGORITHM_VERSION,
  type ConversationGroupingRepository,
  type ConversationGroupingSummary,
} from "./types";

export async function runConversationGrouping(options: {
  repository: ConversationGroupingRepository;
  limit: number;
}): Promise<ConversationGroupingSummary> {
  const sources = await options.repository.loadSources(options.limit);
  const decisions = groupConversationMessages(sources);
  const persisted = await options.repository.applyDecisions({
    algorithmVersion: GROUPING_ALGORITHM_VERSION,
    decisions,
  });
  return {
    messagesConsidered: sources.length,
    ...persisted,
    openaiRequests: 0,
    checks: evaluateProtectedGroupingChecks(sources, decisions),
  };
}

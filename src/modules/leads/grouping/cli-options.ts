export interface ConversationGroupingCliOptions {
  limit: number;
}

export class ConversationGroupingCliOptionsError extends Error {
  constructor() {
    super("Invalid group:conversations arguments.");
    this.name = "ConversationGroupingCliOptionsError";
  }
}

export function parseConversationGroupingArguments(
  arguments_: readonly string[],
): ConversationGroupingCliOptions {
  let limit = 100;
  for (const argument of arguments_) {
    if (!argument.startsWith("--limit=")) {
      throw new ConversationGroupingCliOptionsError();
    }
    const parsed = Number(argument.slice("--limit=".length));
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 500) {
      throw new ConversationGroupingCliOptionsError();
    }
    limit = parsed;
  }
  return { limit };
}

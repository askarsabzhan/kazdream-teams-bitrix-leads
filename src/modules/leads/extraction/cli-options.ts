export interface GroupExtractionCliOptions {
  limit: number;
  leaseSeconds: number;
}

export class GroupExtractionCliOptionsError extends Error {}

function positiveInteger(value: string | undefined, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new GroupExtractionCliOptionsError(`${option} must be a positive integer.`);
  }
  return parsed;
}

export function parseGroupExtractionArguments(
  arguments_: readonly string[],
): GroupExtractionCliOptions {
  const result: GroupExtractionCliOptions = { limit: 10, leaseSeconds: 300 };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--limit") {
      result.limit = positiveInteger(arguments_[index + 1], "--limit");
      index += 1;
    } else if (argument === "--lease-seconds") {
      result.leaseSeconds = positiveInteger(
        arguments_[index + 1],
        "--lease-seconds",
      );
      index += 1;
    } else {
      throw new GroupExtractionCliOptionsError(`Unknown option: ${argument}`);
    }
  }
  return result;
}

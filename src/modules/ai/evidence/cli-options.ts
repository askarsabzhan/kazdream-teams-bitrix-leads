export interface AttachmentEvidenceCliOptions {
  limit: number;
  leaseSeconds: number;
}

export class AttachmentEvidenceCliOptionsError extends Error {
  constructor() {
    super("Invalid ai:evidence arguments.");
    this.name = "AttachmentEvidenceCliOptionsError";
  }
}

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new AttachmentEvidenceCliOptionsError();
  }
  return parsed;
}

export function parseAttachmentEvidenceArguments(
  arguments_: readonly string[],
): AttachmentEvidenceCliOptions {
  let limit = 5;
  let leaseSeconds = 300;
  for (const argument of arguments_) {
    if (argument.startsWith("--limit=")) {
      limit = boundedInteger(argument.slice("--limit=".length), 1, 25);
    } else if (argument.startsWith("--lease-seconds=")) {
      leaseSeconds = boundedInteger(
        argument.slice("--lease-seconds=".length),
        30,
        1800,
      );
    } else {
      throw new AttachmentEvidenceCliOptionsError();
    }
  }
  return { limit, leaseSeconds };
}

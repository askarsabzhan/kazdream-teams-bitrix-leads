export interface AttachmentAcquireCliOptions {
  limit: number;
  leaseSeconds: number;
}

export class AttachmentAcquireCliOptionsError extends Error {
  constructor() {
    super("Invalid attachments:acquire arguments.");
    this.name = "AttachmentAcquireCliOptionsError";
  }
}

function parseBoundedInteger(
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
    throw new AttachmentAcquireCliOptionsError();
  }
  return parsed;
}

export function parseAttachmentAcquireArguments(
  arguments_: readonly string[],
): AttachmentAcquireCliOptions {
  let limit = 5;
  let leaseSeconds = 300;
  for (const argument of arguments_) {
    if (argument.startsWith("--limit=")) {
      limit = parseBoundedInteger(argument.slice("--limit=".length), 1, 25);
    } else if (argument.startsWith("--lease-seconds=")) {
      leaseSeconds = parseBoundedInteger(
        argument.slice("--lease-seconds=".length),
        30,
        1800,
      );
    } else {
      throw new AttachmentAcquireCliOptionsError();
    }
  }
  return { limit, leaseSeconds };
}

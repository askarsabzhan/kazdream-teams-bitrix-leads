export type WorkflowStageKey =
  | "received"
  | "sourcesProcessed"
  | "grouped"
  | "extracted"
  | "canonicalized"
  | "synced";

export type WorkflowStage = {
  key: WorkflowStageKey;
  complete: boolean;
  occurredAt: string | null;
};

type WorkflowAttachment = {
  processingState: string;
  processedAt: string | null;
};

type WorkflowMessage = {
  createdAt: string;
  groupingState: string;
  groupedAt: string | null;
  attachments: readonly WorkflowAttachment[];
};

type WorkflowGroup = {
  extractionState: string;
  extractionCompletedAt: string | null;
  canonicalizationState: string;
  canonicalizedAt: string | null;
  messages: readonly WorkflowMessage[];
};

export type LeadWorkflow = {
  stages: WorkflowStage[];
  durationMs: number | null;
};

function validTime(value: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function boundaryDate(
  values: readonly (string | null)[],
  boundary: "earliest" | "latest",
): string | null {
  const valid = values.flatMap((value) => {
    const time = validTime(value);
    return time === null ? [] : [{ value: value as string, time }];
  });
  if (valid.length === 0) return null;
  valid.sort((left, right) => left.time - right.time);
  return boundary === "earliest" ? valid[0].value : valid[valid.length - 1].value;
}

export function buildLeadWorkflow(input: {
  crmStatus: string;
  syncedAt: string | null;
  groups: readonly WorkflowGroup[];
}): LeadWorkflow {
  const messages = input.groups.flatMap((group) => group.messages);
  const attachments = messages.flatMap((message) => message.attachments);
  const receivedAt = boundaryDate(
    messages.map((message) => message.createdAt),
    "earliest",
  );
  const processedAt = boundaryDate(
    attachments.map((attachment) => attachment.processedAt),
    "latest",
  );
  const groupedAt = boundaryDate(
    messages.map((message) => message.groupedAt),
    "latest",
  );
  const extractedAt = boundaryDate(
    input.groups.map((group) => group.extractionCompletedAt),
    "latest",
  );
  const canonicalizedAt = boundaryDate(
    input.groups.map((group) => group.canonicalizedAt),
    "latest",
  );
  const sourcesComplete =
    input.groups.length > 0 &&
    (attachments.length === 0 ||
      attachments.every((attachment) =>
        ["processed", "unsupported"].includes(attachment.processingState),
      ));
  const synced = input.crmStatus === "succeeded" && Boolean(input.syncedAt);
  const start = validTime(receivedAt);
  const end = validTime(synced ? input.syncedAt : null);

  return {
    stages: [
      { key: "received", complete: Boolean(receivedAt), occurredAt: receivedAt },
      { key: "sourcesProcessed", complete: sourcesComplete, occurredAt: processedAt },
      {
        key: "grouped",
        complete:
          messages.length > 0 &&
          messages.every((message) => message.groupingState === "grouped"),
        occurredAt: groupedAt,
      },
      {
        key: "extracted",
        complete:
          input.groups.length > 0 &&
          input.groups.every((group) => group.extractionState === "extracted"),
        occurredAt: extractedAt,
      },
      {
        key: "canonicalized",
        complete:
          input.groups.length > 0 &&
          input.groups.every((group) => group.canonicalizationState === "linked"),
        occurredAt: canonicalizedAt,
      },
      { key: "synced", complete: synced, occurredAt: synced ? input.syncedAt : null },
    ],
    durationMs:
      start !== null && end !== null && end >= start ? end - start : null,
  };
}

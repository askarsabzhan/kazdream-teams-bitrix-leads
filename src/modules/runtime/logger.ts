export const PIPELINE_STAGE_ORDER = [
  "teams_ingestion",
  "attachment_acquisition",
  "attachment_ai_evidence",
  "conversation_grouping",
  "group_extraction",
  "canonicalization",
  "bitrix_sync",
] as const;

export type PipelineStageName = (typeof PIPELINE_STAGE_ORDER)[number];

export type SafeWorkerEvent = {
  event:
    | "worker_started"
    | "worker_stopping"
    | "worker_stopped"
    | "iteration_failed"
    | "stage_complete"
    | "stage_failed";
  stage?: PipelineStageName;
  code?: string;
  durationMs?: number;
  pollIntervalMs?: number;
  counts?: Record<string, number>;
};

export type SafeWorkerLogger = {
  info(event: SafeWorkerEvent): void;
  error(event: SafeWorkerEvent): void;
};

function safeCode(value: string | undefined): string | undefined {
  return value && /^[A-Z0-9_]{1,64}$/u.test(value) ? value : undefined;
}

export function serializeSafeWorkerEvent(
  level: "info" | "error",
  event: SafeWorkerEvent,
): string {
  return JSON.stringify({
    level,
    event: event.event,
    ...(event.stage ? { stage: event.stage } : {}),
    ...(safeCode(event.code) ? { code: event.code } : {}),
    ...(Number.isFinite(event.durationMs) ? { duration_ms: event.durationMs } : {}),
    ...(Number.isFinite(event.pollIntervalMs)
      ? { poll_interval_ms: event.pollIntervalMs }
      : {}),
    ...(event.counts ? { counts: event.counts } : {}),
  });
}

export function createSafeConsoleLogger(options: {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
} = {}): SafeWorkerLogger {
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  return {
    info: (event) => stdout(serializeSafeWorkerEvent("info", event)),
    error: (event) => stderr(serializeSafeWorkerEvent("error", event)),
  };
}

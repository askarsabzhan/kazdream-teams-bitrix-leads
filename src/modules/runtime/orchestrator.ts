import {
  PIPELINE_STAGE_ORDER,
  type PipelineStageName,
  type SafeWorkerLogger,
} from "./logger";

export type PipelineStage = {
  name: PipelineStageName;
  run(): Promise<unknown>;
};

function safeErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "UNEXPECTED_ORCHESTRATION_ERROR";
  }
  const candidates = [
    "code" in error ? error.code : undefined,
    "safe" in error && typeof error.safe === "object" && error.safe !== null && "code" in error.safe
      ? error.safe.code
      : undefined,
  ];
  const match = candidates.find(
    (value): value is string =>
      typeof value === "string" && /^[A-Z0-9_]{1,64}$/u.test(value),
  );
  return match ?? "UNEXPECTED_ORCHESTRATION_ERROR";
}

export function numericCounts(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        /^[a-z][A-Za-z0-9]{0,63}$/u.test(entry[0]) &&
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1]),
    ),
  );
}

export function assertProductionStageOrder(stages: readonly PipelineStage[]): void {
  const actual = stages.map((stage) => stage.name);
  if (
    actual.length !== PIPELINE_STAGE_ORDER.length ||
    actual.some((name, index) => name !== PIPELINE_STAGE_ORDER[index])
  ) {
    throw new Error("Production pipeline stage order is invalid.");
  }
}

export async function runPipelineIteration(options: {
  stages: readonly PipelineStage[];
  logger: SafeWorkerLogger;
  shouldStop?: () => boolean;
  now?: () => number;
}): Promise<{ completed: PipelineStageName[]; failed: PipelineStageName[] }> {
  assertProductionStageOrder(options.stages);
  const now = options.now ?? Date.now;
  const completed: PipelineStageName[] = [];
  const failed: PipelineStageName[] = [];

  for (const stage of options.stages) {
    if (options.shouldStop?.()) break;
    const startedAt = now();
    try {
      const summary = await stage.run();
      completed.push(stage.name);
      options.logger.info({
        event: "stage_complete",
        stage: stage.name,
        durationMs: Math.max(0, now() - startedAt),
        counts: numericCounts(summary),
      });
    } catch (error) {
      failed.push(stage.name);
      options.logger.error({
        event: "stage_failed",
        stage: stage.name,
        code: safeErrorCode(error),
        durationMs: Math.max(0, now() - startedAt),
      });
    }
  }

  return { completed, failed };
}

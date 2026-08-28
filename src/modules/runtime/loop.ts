import type { SafeWorkerLogger } from "./logger";

export type WorkerStopSignal = { isStopping(): boolean };

export async function runWorkerLoop(options: {
  pollIntervalMs: number;
  signal: WorkerStopSignal;
  logger: SafeWorkerLogger;
  runIteration(): Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  options.logger.info({
    event: "worker_started",
    pollIntervalMs: options.pollIntervalMs,
  });

  while (!options.signal.isStopping()) {
    try {
      await options.runIteration();
    } catch {
      options.logger.error({
        event: "iteration_failed",
        code: "UNEXPECTED_ORCHESTRATION_ERROR",
      });
    }
    if (!options.signal.isStopping()) await sleep(options.pollIntervalMs);
  }

  options.logger.info({ event: "worker_stopped" });
}

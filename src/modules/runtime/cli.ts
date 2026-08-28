import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { readWorkerRuntimeConfiguration } from "./config";
import { createSafeConsoleLogger } from "./logger";
import { runWorkerLoop } from "./loop";
import { runPipelineIteration } from "./orchestrator";
import { createProductionPipelineStages } from "./production";

function loadLocalEnvironment(): void {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const logger = createSafeConsoleLogger();
  const configuration = readWorkerRuntimeConfiguration();
  const stages = createProductionPipelineStages();
  const args = process.argv.slice(2);
  const oneShot = args.length === 1 && args[0] === "--once";
  if (args.length > (oneShot ? 1 : 0)) {
    throw new Error("Invalid worker arguments.");
  }

  let stopping = false;
  const requestStop = () => {
    if (!stopping) logger.info({ event: "worker_stopping" });
    stopping = true;
  };
  process.once("SIGTERM", requestStop);
  process.once("SIGINT", requestStop);

  const runIteration = async () => {
    await runPipelineIteration({
      stages,
      logger,
      shouldStop: () => stopping,
    });
  };

  if (oneShot) {
    await runIteration();
    return;
  }
  await runWorkerLoop({
    pollIntervalMs: configuration.pollIntervalMs,
    signal: { isStopping: () => stopping },
    logger,
    runIteration,
  });
}

main().catch(() => {
  createSafeConsoleLogger().error({
    event: "iteration_failed",
    code: "WORKER_STARTUP_ERROR",
  });
  process.exitCode = 1;
});

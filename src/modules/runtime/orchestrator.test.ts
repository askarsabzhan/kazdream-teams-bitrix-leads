import { describe, expect, it, vi } from "vitest";

import {
  PIPELINE_STAGE_ORDER,
  createSafeConsoleLogger,
  type SafeWorkerEvent,
  type SafeWorkerLogger,
} from "./logger";
import { runPipelineIteration, type PipelineStage } from "./orchestrator";

function collectingLogger(events: SafeWorkerEvent[]): SafeWorkerLogger {
  return {
    info: (event) => events.push(event),
    error: (event) => events.push(event),
  };
}

describe("production pipeline orchestrator", () => {
  it("runs the exact production order and isolates a stage failure", async () => {
    const calls: string[] = [];
    const events: SafeWorkerEvent[] = [];
    const stages: PipelineStage[] = PIPELINE_STAGE_ORDER.map((name) => ({
      name,
      run: async () => {
        calls.push(name);
        if (name === "attachment_ai_evidence") {
          throw Object.assign(new Error("private payload"), {
            code: "PROVIDER_UNAVAILABLE",
          });
        }
        return { processed: 1, sourceText: "must not be logged" };
      },
    }));

    const result = await runPipelineIteration({
      stages,
      logger: collectingLogger(events),
      now: vi.fn().mockReturnValue(1),
    });

    expect(calls).toEqual(PIPELINE_STAGE_ORDER);
    expect(result.failed).toEqual(["attachment_ai_evidence"]);
    expect(result.completed).toHaveLength(PIPELINE_STAGE_ORDER.length - 1);
    expect(JSON.stringify(events)).not.toContain("private payload");
    expect(JSON.stringify(events)).not.toContain("must not be logged");
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "stage_failed",
        code: "PROVIDER_UNAVAILABLE",
      }),
    );
  });

  it("serializes only explicitly safe operational fields", () => {
    const output: string[] = [];
    const logger = createSafeConsoleLogger({
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
    });
    const unsafe = {
      event: "stage_failed",
      code: "token=value",
      detail: "visitor@example.invalid",
    } as unknown as SafeWorkerEvent;

    logger.error(unsafe);

    expect(output).toHaveLength(1);
    expect(output[0]).not.toContain("token=value");
    expect(output[0]).not.toContain("visitor@example.invalid");
  });
});

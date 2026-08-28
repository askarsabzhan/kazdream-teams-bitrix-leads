import { describe, expect, it, vi } from "vitest";

import type { SafeWorkerEvent, SafeWorkerLogger } from "./logger";
import { runWorkerLoop } from "./loop";

describe("worker loop", () => {
  it("continues after an unexpected iteration failure and stops cleanly", async () => {
    const events: SafeWorkerEvent[] = [];
    const logger: SafeWorkerLogger = {
      info: (event) => events.push(event),
      error: (event) => events.push(event),
    };
    let stopping = false;
    const runIteration = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("private failure"))
      .mockImplementationOnce(async () => {
        stopping = true;
      });
    const sleep = vi.fn(async () => undefined);

    await runWorkerLoop({
      pollIntervalMs: 10_000,
      signal: { isStopping: () => stopping },
      logger,
      runIteration,
      sleep,
    });

    expect(runIteration).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(events.map((event) => event.event)).toEqual([
      "worker_started",
      "iteration_failed",
      "worker_stopped",
    ]);
    expect(JSON.stringify(events)).not.toContain("private failure");
  });
});

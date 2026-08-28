import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKER_POLL_INTERVAL_MS,
  readWorkerRuntimeConfiguration,
} from "./config";

describe("worker runtime configuration", () => {
  it("uses the production-safe default", () => {
    expect(readWorkerRuntimeConfiguration({}).pollIntervalMs).toBe(
      DEFAULT_WORKER_POLL_INTERVAL_MS,
    );
  });

  it.each(["5000", "10000", "15000"])(
    "accepts the bounded interval %s",
    (value) => {
      expect(
        readWorkerRuntimeConfiguration({ WORKER_POLL_INTERVAL_MS: value })
          .pollIntervalMs,
      ).toBe(Number(value));
    },
  );

  it.each(["4999", "15001", "not-a-number"])(
    "rejects an unsafe interval %s",
    (value) => {
      expect(() =>
        readWorkerRuntimeConfiguration({ WORKER_POLL_INTERVAL_MS: value }),
      ).toThrow();
    },
  );
});

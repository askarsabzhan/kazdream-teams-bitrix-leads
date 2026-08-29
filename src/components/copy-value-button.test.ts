import { describe, expect, it, vi } from "vitest";

import { copyExactValue } from "./copy-value-button";

describe("copy value action", () => {
  it("copies the exact displayed value without correction", async () => {
    const writeText = vi.fn(async () => undefined);
    const suspiciousEmail = "person@example.corn";

    await copyExactValue(suspiciousEmail, { writeText });

    expect(writeText).toHaveBeenCalledExactlyOnceWith(suspiciousEmail);
  });
});

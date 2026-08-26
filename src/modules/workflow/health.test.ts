import { describe, expect, it } from "vitest";
import { getLivenessStatus } from "./health";

describe("liveness status", () => {
  it("reports that the application process is alive", () => {
    expect(getLivenessStatus()).toEqual({ status: "ok" });
  });
});

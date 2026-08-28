import { describe, expect, it } from "vitest";
import { getLivenessStatus } from "./health";

describe("liveness status", () => {
  it("reports application and database availability", async () => {
    await expect(getLivenessStatus(async () => true)).resolves.toEqual({
      status: "ok",
      application: "ok",
      database: "ok",
    });
  });

  it("returns a safe unavailable status when the database probe fails", async () => {
    await expect(
      getLivenessStatus(async () => {
        throw new Error("sensitive diagnostic");
      }),
    ).resolves.toEqual({
      status: "unavailable",
      application: "ok",
      database: "unavailable",
    });
  });
});

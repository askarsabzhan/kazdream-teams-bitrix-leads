import { describe, expect, it } from "vitest";

import {
  parseTeamsIngestArguments,
  TeamsIngestCliOptionsError,
} from "./cli-options";

const now = new Date("2026-08-27T08:00:00Z");

describe("teams:ingest CLI options", () => {
  it("supports a bounded latest dry run", () => {
    expect(
      parseTeamsIngestArguments(["--dry-run", "--limit=8"], now),
    ).toMatchObject({
      mode: "latest",
      dryRun: true,
      verify: false,
      verifyOnly: false,
      limit: 8,
    });
  });

  it("supports an explicit bounded catch-up range", () => {
    expect(
      parseTeamsIngestArguments(
        [
          "--mode=catch-up",
          "--limit=200",
          "--since=2026-08-26T00:00:00Z",
          "--until=2026-08-27T00:00:00Z",
        ],
        now,
      ),
    ).toMatchObject({
      mode: "catch-up",
      limit: 200,
      since: "2026-08-26T00:00:00.000Z",
      until: "2026-08-27T00:00:00.000Z",
    });
  });

  it("rejects unbounded or contradictory options", () => {
    expect(() =>
      parseTeamsIngestArguments(["--limit=51"], now),
    ).toThrowError(TeamsIngestCliOptionsError);
    expect(() =>
      parseTeamsIngestArguments(["--dry-run", "--verify"], now),
    ).toThrowError(TeamsIngestCliOptionsError);
  });
});

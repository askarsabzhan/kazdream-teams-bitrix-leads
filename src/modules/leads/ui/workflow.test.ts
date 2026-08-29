import { describe, expect, it } from "vitest";

import { buildLeadWorkflow } from "./workflow";

describe("lead processing timeline", () => {
  it("uses persisted stage times and calculates the real end-to-end duration", () => {
    const workflow = buildLeadWorkflow({
      crmStatus: "succeeded",
      syncedAt: "2026-08-29T10:00:50.000Z",
      groups: [
        {
          extractionState: "extracted",
          extractionCompletedAt: "2026-08-29T10:00:30.000Z",
          canonicalizationState: "linked",
          canonicalizedAt: "2026-08-29T10:00:40.000Z",
          messages: [
            {
              createdAt: "2026-08-29T10:00:00.000Z",
              groupingState: "grouped",
              groupedAt: "2026-08-29T10:00:20.000Z",
              attachments: [
                {
                  processingState: "processed",
                  processedAt: "2026-08-29T10:00:10.000Z",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(workflow.stages.map((stage) => stage.complete)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(workflow.stages.map((stage) => stage.occurredAt)).toEqual([
      "2026-08-29T10:00:00.000Z",
      "2026-08-29T10:00:10.000Z",
      "2026-08-29T10:00:20.000Z",
      "2026-08-29T10:00:30.000Z",
      "2026-08-29T10:00:40.000Z",
      "2026-08-29T10:00:50.000Z",
    ]);
    expect(workflow.durationMs).toBe(50_000);
  });

  it("does not invent unavailable timestamps", () => {
    const workflow = buildLeadWorkflow({
      crmStatus: "pending",
      syncedAt: null,
      groups: [],
    });

    expect(workflow.stages.every((stage) => stage.occurredAt === null)).toBe(true);
    expect(workflow.durationMs).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { presentSourceMessage } from "./source-message";

describe("source message presentation", () => {
  it("marks a missing Teams body as attachment-only", () => {
    expect(presentSourceMessage(null)).toEqual({ hasText: false, text: null });
    expect(presentSourceMessage("   ")).toEqual({ hasText: false, text: null });
  });

  it("preserves a real text-only Teams body exactly", () => {
    const body = "  Original Teams body with .corn and punctuation!  ";

    expect(presentSourceMessage(body)).toEqual({ hasText: true, text: body });
  });
});

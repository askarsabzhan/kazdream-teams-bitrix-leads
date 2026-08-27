import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { collectPaginated } from "./pagination";

describe("Graph pagination", () => {
  it("follows next links and returns a complete bounded collection", async () => {
    const pages = new Map([
      [
        "/first",
        {
          value: [1, 2],
          nextLink: "https://graph.microsoft.com/v1.0/next",
        },
      ],
      ["https://graph.microsoft.com/v1.0/next", { value: [3] }],
    ]);

    const result = await collectPaginated({
      initialEndpoint: "/first",
      fetchPage: async (endpoint) => {
        const page = pages.get(endpoint);
        if (!page) throw new Error("Unexpected page");
        return page;
      },
    });

    expect(result).toMatchObject({
      items: [1, 2, 3],
      pageCount: 2,
      initialHadNextLink: true,
      complete: true,
    });
  });

  it("reports an incomplete result at a configured page boundary", async () => {
    const result = await collectPaginated({
      initialEndpoint: "/first",
      maxPages: 1,
      fetchPage: async () => ({
        value: [1],
        nextLink: "https://graph.microsoft.com/v1.0/next",
      }),
    });

    expect(result).toMatchObject({
      items: [1],
      pageCount: 1,
      initialHadNextLink: true,
      complete: false,
      remainingNextLink: "https://graph.microsoft.com/v1.0/next",
    });
  });
});

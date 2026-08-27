import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GraphClient,
  GraphRequestError,
  sanitizeRemoteDescription,
} from "./client";

describe("Microsoft Graph client safety", () => {
  it("returns a sanitized Graph error instead of the raw response", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "Authorization_RequestDenied",
            message:
              "Denied for manager@example.com at https://tenant.example/item using Bearer abcdefghijkl.mnopqrstuvwx.yzABCDEFGHIJ and 6f9619ff-8b86-d011-b42d-00cf4fc964ff",
          },
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      ),
    ) as unknown as typeof fetch;
    const client = new GraphClient(async () => "memory-only-token", {
      fetchImplementation,
    });

    await expect(
      client.getJson("/users?$top=1", "GET /users?$top=1"),
    ).rejects.toMatchObject({
      safe: {
        httpStatus: 403,
        code: "Authorization_RequestDenied",
      },
    });

    try {
      await client.getJson("/users?$top=1", "GET /users?$top=1");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphRequestError);
      const description = (error as GraphRequestError).safe.description;
      expect(description).not.toContain("manager@example.com");
      expect(description).not.toContain("tenant.example");
      expect(description).not.toContain("abcdefghijkl");
      expect(description).not.toContain("6f9619ff");
    }
  });

  it("sanitizes keyed secrets and authorization values", () => {
    const output = sanitizeRemoteDescription(
      "client_secret=secret-value Authorization: Bearer abc.def.ghi",
    );

    expect(output).not.toContain("secret-value");
    expect(output).not.toContain("abc.def.ghi");
  });

  it("rejects an oversized Content-Length before reading bytes", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(new Uint8Array([1]), {
        headers: {
          "content-length": "11",
          "content-type": "image/png",
        },
      }),
    ) as unknown as typeof fetch;
    const client = new GraphClient(async () => "memory-only-token", {
      fetchImplementation,
    });

    await expect(
      client.getBoundedBytes("/bounded", "GET /bounded", 10),
    ).rejects.toMatchObject({ safe: { code: "FILE_TOO_LARGE" } });
  });

  it("aborts a streamed response when the byte counter exceeds the limit", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.enqueue(new Uint8Array([4, 5, 6]));
            controller.close();
          },
        }),
        { headers: { "content-type": "audio/mpeg" } },
      ),
    ) as unknown as typeof fetch;
    const client = new GraphClient(async () => "memory-only-token", {
      fetchImplementation,
    });

    await expect(
      client.getBoundedBytes("/bounded", "GET /bounded", 5),
    ).rejects.toMatchObject({ safe: { code: "FILE_TOO_LARGE" } });
  });

  it("returns exact bounded bytes and the declared response MIME", async () => {
    const fetchImplementation = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png; charset=binary" },
      }),
    ) as unknown as typeof fetch;
    const client = new GraphClient(async () => "memory-only-token", {
      fetchImplementation,
    });

    const result = await client.getBoundedBytes(
      "/bounded",
      "GET /bounded",
      3,
    );

    expect(result.contentType).toBe("image/png");
    expect([...result.bytes]).toEqual([1, 2, 3]);
  });
});

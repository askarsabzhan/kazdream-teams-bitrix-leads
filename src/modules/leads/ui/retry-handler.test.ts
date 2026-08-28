import { describe, expect, it, vi } from "vitest";

import { createCrmRetryHandler } from "./retry-handler";

const leadId = "63000000-0000-4000-8000-000000000063";

describe("CRM retry handler", () => {
  it("requires authentication", async () => {
    const retry = vi.fn();
    const handler = createCrmRetryHandler({ isAuthenticated: async () => false, retry });
    expect((await handler(leadId)).status).toBe(401);
    expect(retry).not.toHaveBeenCalled();
  });

  it("passes only the validated local lead id to the durable retry boundary", async () => {
    const retry = vi.fn(async () => ({ outcome: "queued", crm_status: "pending" }));
    const handler = createCrmRetryHandler({ isAuthenticated: async () => true, retry });
    const response = await handler(leadId);
    expect(response.status).toBe(202);
    expect(retry).toHaveBeenCalledWith(leadId);
    expect(retry.mock.calls[0]).toHaveLength(1);
  });

  it("rejects an injected payload in place of a UUID", async () => {
    const retry = vi.fn();
    const handler = createCrmRetryHandler({ isAuthenticated: async () => true, retry });
    expect((await handler('{"method":"crm.lead.add"}')).status).toBe(400);
    expect(retry).not.toHaveBeenCalled();
  });
});

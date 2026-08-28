import { z } from "zod";

export type RetryOutcome = {
  outcome: string;
  crm_status: string;
};

export type RetryHandlerDependencies = {
  isAuthenticated: () => Promise<boolean>;
  retry: (leadId: string) => Promise<RetryOutcome>;
};

const leadIdSchema = z.string().uuid();

export function createCrmRetryHandler(dependencies: RetryHandlerDependencies) {
  return async function handleCrmRetry(leadId: string): Promise<Response> {
    if (!(await dependencies.isAuthenticated())) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const parsed = leadIdSchema.safeParse(leadId);
    if (!parsed.success) {
      return Response.json({ error: "Invalid lead." }, { status: 400 });
    }

    try {
      const result = await dependencies.retry(parsed.data);
      const accepted = ["queued", "already_queued", "already_processing"].includes(result.outcome);
      return Response.json(
        { outcome: result.outcome, crmStatus: result.crm_status },
        { status: accepted ? 202 : 409 },
      );
    } catch {
      return Response.json({ error: "CRM retry could not be requested." }, { status: 500 });
    }
  };
}

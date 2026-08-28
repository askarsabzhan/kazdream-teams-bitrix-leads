import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getViewer } from "@/modules/auth/session";
import {
  createCrmRetryHandler,
  type RetryOutcome,
} from "@/modules/leads/ui/retry-handler";

const handler = createCrmRetryHandler({
  isAuthenticated: async () => Boolean(await getViewer()),
  retry: async (leadId) => {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.rpc("retry_current_crm_sync", { p_lead_id: leadId });
    if (result.error || !result.data?.[0]) throw new Error("CRM retry failed.");
    return result.data[0] as RetryOutcome;
  },
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handler(id);
}

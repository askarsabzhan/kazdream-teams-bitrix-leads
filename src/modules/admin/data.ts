import "server-only";

import { readServerEnvironment } from "@/lib/env/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type QueueName = "processing_jobs" | "crm_outbox" | "teams_notifications";

export type AdminDashboard = {
  health: Array<{ name: string; configured: boolean }>;
  campaign: {
    name: string;
    source: string | null;
    exhibitionBitrixId: number | null;
    active: boolean;
  } | null;
  managerMappings: Array<{
    teamsIdentity: string | null;
    bitrixUserId: number;
    active: boolean;
  }>;
  referenceMappings: Array<{
    fieldType: string;
    canonicalKey: string;
    displayLabel: string;
    bitrixValueId: number;
    active: boolean;
  }>;
  queues: Array<{ name: QueueName; status: string; count: number }>;
};

export async function loadAdminDashboard(): Promise<AdminDashboard> {
  const environment = readServerEnvironment();
  const supabase = await createSupabaseServerClient();

  const [campaignResult, managersResult, referencesResult] = await Promise.all([
    supabase
      .from("campaigns")
      .select("name, source_id, exhibition_bitrix_id, is_active")
      .eq("exhibition_key", "hannover_messe_2026")
      .maybeSingle(),
    supabase
      .from("manager_mappings")
      .select("teams_display_name, teams_user_principal_name, bitrix_user_id, is_active")
      .order("created_at", { ascending: true }),
    supabase
      .from("reference_mappings")
      .select("field_type, canonical_key, display_label, bitrix_value_id, is_active")
      .order("field_type", { ascending: true })
      .order("canonical_key", { ascending: true }),
  ]);

  if (campaignResult.error || managersResult.error || referencesResult.error) {
    throw new Error("Unable to load admin configuration.");
  }

  const queueNames: QueueName[] = ["processing_jobs", "crm_outbox", "teams_notifications"];
  const queueRows = await Promise.all(
    queueNames.map(async (name) => {
      const result = await supabase.from(name).select("status");
      if (result.error) throw new Error("Unable to load queue status.");
      const counts = new Map<string, number>();
      for (const row of result.data ?? []) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      return [...counts].map(([status, count]) => ({ name, status, count }));
    }),
  );

  return {
    health: [
      {
        name: "Microsoft Graph",
        configured: Boolean(environment.MS_TENANT_ID && environment.MS_CLIENT_ID && environment.MS_CLIENT_SECRET),
      },
      { name: "OpenAI", configured: Boolean(environment.OPENAI_API_KEY) },
      {
        name: "Supabase",
        configured: Boolean(
          environment.NEXT_PUBLIC_SUPABASE_URL && environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        ),
      },
      { name: "Bitrix", configured: Boolean(environment.BITRIX_WEBHOOK_BASE_URL) },
    ],
    campaign: campaignResult.data
      ? {
          name: campaignResult.data.name,
          source: campaignResult.data.source_id,
          exhibitionBitrixId: campaignResult.data.exhibition_bitrix_id,
          active: campaignResult.data.is_active,
        }
      : null,
    managerMappings: (managersResult.data ?? []).map((mapping) => ({
      teamsIdentity: mapping.teams_display_name ?? mapping.teams_user_principal_name,
      bitrixUserId: mapping.bitrix_user_id,
      active: mapping.is_active,
    })),
    referenceMappings: (referencesResult.data ?? []).map((mapping) => ({
      fieldType: mapping.field_type,
      canonicalKey: mapping.canonical_key,
      displayLabel: mapping.display_label,
      bitrixValueId: mapping.bitrix_value_id,
      active: mapping.is_active,
    })),
    queues: queueRows.flat(),
  };
}

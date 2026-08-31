import "server-only";

import { readServerEnvironment } from "@/lib/env/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { buildIntegrationHealth } from "./integration-health";

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

  const [
    campaignResult,
    managersResult,
    referencesResult,
    teamsEvidenceResult,
    openAIEvidenceResult,
    bitrixEvidenceResult,
  ] = await Promise.all([
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
    supabase.from("teams_messages").select("id").limit(1),
    supabase.from("leads").select("id").eq("summary_state", "succeeded").limit(1),
    supabase.from("leads").select("id").not("bitrix_lead_id", "is", null).limit(1),
  ]);

  if (
    campaignResult.error ||
    managersResult.error ||
    referencesResult.error ||
    teamsEvidenceResult.error ||
    openAIEvidenceResult.error ||
    bitrixEvidenceResult.error
  ) {
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
    health: buildIntegrationHealth({
      environment: {
        teams: Boolean(environment.MS_TENANT_ID && environment.MS_CLIENT_ID && environment.MS_CLIENT_SECRET),
        openAI: Boolean(environment.OPENAI_API_KEY),
        supabase: Boolean(
          environment.NEXT_PUBLIC_SUPABASE_URL && environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        ),
        bitrix: Boolean(environment.BITRIX_WEBHOOK_BASE_URL),
      },
      persisted: {
        supabaseConnected: true,
        hasTeamsMessages: Boolean(teamsEvidenceResult.data?.length),
        hasOpenAISuccess: Boolean(openAIEvidenceResult.data?.length),
        hasBitrixSuccess: Boolean(bitrixEvidenceResult.data?.length),
      },
    }),
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

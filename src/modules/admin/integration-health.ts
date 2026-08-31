export type IntegrationHealth = Array<{
  name: "Microsoft Graph" | "OpenAI" | "Supabase" | "Bitrix";
  configured: boolean;
}>;

export function buildIntegrationHealth(options: {
  environment: {
    teams: boolean;
    openAI: boolean;
    supabase: boolean;
    bitrix: boolean;
  };
  persisted: {
    supabaseConnected: boolean;
    hasTeamsMessages: boolean;
    hasOpenAISuccess: boolean;
    hasBitrixSuccess: boolean;
  };
}): IntegrationHealth {
  return [
    {
      name: "Microsoft Graph",
      configured: options.environment.teams || options.persisted.hasTeamsMessages,
    },
    {
      name: "OpenAI",
      configured: options.environment.openAI || options.persisted.hasOpenAISuccess,
    },
    {
      name: "Supabase",
      configured: options.environment.supabase || options.persisted.supabaseConnected,
    },
    {
      name: "Bitrix",
      configured: options.environment.bitrix || options.persisted.hasBitrixSuccess,
    },
  ];
}

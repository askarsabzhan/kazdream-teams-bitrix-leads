import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireServerEnvironment } from "../env/server";

export function createSupabaseAdminClient(): SupabaseClient {
  const environment = requireServerEnvironment([
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const);

  return createClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}

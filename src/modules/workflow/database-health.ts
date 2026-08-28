import "server-only";

import { requireServerEnvironment } from "@/lib/env/server";

const DATABASE_HEALTH_TIMEOUT_MS = 2_000;

export async function probeDatabaseHealth(): Promise<boolean> {
  try {
    const environment = requireServerEnvironment([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ] as const);
    const response = await fetch(
      new URL("/rest/v1/", environment.NEXT_PUBLIC_SUPABASE_URL),
      {
        method: "HEAD",
        headers: {
          apikey: environment.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${environment.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(DATABASE_HEALTH_TIMEOUT_MS),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

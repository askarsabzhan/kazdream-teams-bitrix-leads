import { describe, expect, it } from "vitest";

import { readPublicEnvironment } from "./public";

describe("public environment", () => {
  it("returns only the explicit public Supabase configuration", () => {
    const result = readPublicEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-escape",
      BITRIX_WEBHOOK_BASE_URL: "https://example.test/secret-path",
      MS_CLIENT_SECRET: "must-not-escape",
    });

    expect(result).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
    });
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    expect(JSON.stringify(result)).not.toContain("secret-path");
  });
});

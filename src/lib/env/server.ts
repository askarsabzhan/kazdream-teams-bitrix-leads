import "server-only";

import { z } from "zod";

const emptyStringToUndefined = (value: unknown) =>
  value === "" ? undefined : value;

const optionalString = z.preprocess(
  emptyStringToUndefined,
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  emptyStringToUndefined,
  z.url().optional(),
);

export const serverEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  DATABASE_URL: optionalString,
  OPENAI_API_KEY: optionalString,
  OPENAI_TRANSCRIPTION_MODEL: optionalString,
  OPENAI_VISION_MODEL: optionalString,
  BITRIX_WEBHOOK_BASE_URL: optionalUrl,
  MS_TENANT_ID: optionalString,
  MS_CLIENT_ID: optionalString,
  MS_CLIENT_SECRET: optionalString,
  MS_TEAM_NAME: optionalString,
  MS_CHANNEL_NAME: optionalString,
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function readServerEnvironment(
  source: Record<string, string | undefined> = process.env,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(source);
}

export function requireServerEnvironment<
  const Keys extends readonly (keyof ServerEnvironment)[],
>(
  keys: Keys,
  source: Record<string, string | undefined> = process.env,
): ServerEnvironment & {
  [Key in Keys[number]]: Exclude<ServerEnvironment[Key], undefined>;
} {
  const environment = readServerEnvironment(source);
  const missingKeys = keys.filter((key) => environment[key] === undefined);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingKeys.join(", ")}`,
    );
  }

  return environment as ServerEnvironment & {
    [Key in Keys[number]]: Exclude<ServerEnvironment[Key], undefined>;
  };
}

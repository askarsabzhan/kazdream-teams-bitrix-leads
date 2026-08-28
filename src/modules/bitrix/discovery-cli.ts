import "server-only";

import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { requireServerEnvironment } from "../../lib/env/server";

import { BitrixClient } from "./client";
import {
  REQUIRED_CUSTOM_LEAD_FIELDS,
  discoverBitrix,
} from "./discovery";
import { BitrixSyncError } from "./errors";
import { formatDiscoveryChecks } from "./format";

if (existsSync(".env.local")) loadEnvFile(".env.local");

async function main(): Promise<void> {
  const environment = requireServerEnvironment(["BITRIX_WEBHOOK_BASE_URL"] as const);
  const discovery = await discoverBitrix(
    new BitrixClient(environment.BITRIX_WEBHOOK_BASE_URL),
  );
  console.log(formatDiscoveryChecks(discovery));
  const safeMetadata = Object.fromEntries(
    REQUIRED_CUSTOM_LEAD_FIELDS.map((name) => {
      const field = discovery.fields[name];
      return [
        name,
        field
          ? {
              type: field.type,
              multiple: field.multiple,
              items: field.items,
            }
          : null,
      ];
    }),
  );
  console.log(`BITRIX_FIELD_METADATA=${JSON.stringify(safeMetadata)}`);
}

main().catch((error: unknown) => {
  if (error instanceof BitrixSyncError) {
    console.error(`Bitrix discovery stopped: ${error.code}.`);
  } else if (error instanceof Error && error.message.startsWith("Missing required")) {
    console.error(error.message);
  } else {
    console.error("Bitrix discovery stopped before a safe result was produced.");
  }
  process.exitCode = 1;
});

import "server-only";

import { BitrixSyncError } from "./errors";
import type {
  BitrixDiscoveryConfiguration,
  BitrixFieldMetadata,
} from "./types";
import type { BitrixClient } from "./client";

export const REQUIRED_STANDARD_LEAD_FIELDS = [
  "TITLE",
  "NAME",
  "COMPANY_TITLE",
  "POST",
  "PHONE",
  "EMAIL",
  "COMMENTS",
  "SOURCE_ID",
  "ASSIGNED_BY_ID",
] as const;

export const REQUIRED_CUSTOM_LEAD_FIELDS = [
  "UF_CRM_LEAD_TYPE",
  "UF_CRM_REGION",
  "UF_CRM_EXHIBITION",
  "UF_CRM_PRODUCT_INTEREST",
  "UF_CRM_PRIORITY",
  "UF_CRM_TEAMS_GROUP_ID",
  "UF_CRM_TEAMS_MESSAGE_IDS",
  "UF_CRM_TEAMS_AUTHOR",
] as const;

export const EXPECTED_ENUMS = {
  UF_CRM_LEAD_TYPE: [
    { id: 45, value: "Partner" },
    { id: 47, value: "Customer" },
  ],
  UF_CRM_REGION: [{ id: 49, value: "Europe" }],
  UF_CRM_EXHIBITION: [{ id: 63, value: "Hannover Messe 2026" }],
  UF_CRM_PRODUCT_INTEREST: [
    { id: 71, value: "Platform/Core" },
    { id: 73, value: "Analytics" },
    { id: 75, value: "Integration Services" },
    { id: 77, value: "Support & SLA" },
    { id: 79, value: "Training" },
    { id: 81, value: "OEM/White label" },
  ],
  UF_CRM_PRIORITY: [
    { id: 83, value: "High" },
    { id: 85, value: "Medium" },
    { id: 87, value: "Low" },
  ],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "Y";
}

function normalizeLabel(value: string): string {
  return value.toLocaleLowerCase("und").replace(/\s*\/\s*/gu, "/").replace(/\s+/gu, " ").trim();
}

function parseItems(value: unknown): Array<{ id: number; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = Number(item.ID ?? item.id);
    const label = asString(item.VALUE ?? item.value);
    return Number.isSafeInteger(id) && id > 0 && label ? [{ id, value: label }] : [];
  });
}

function parseMetadata(
  name: string,
  fieldValue: unknown,
  userFieldValue?: unknown,
): BitrixFieldMetadata | null {
  const field = isRecord(fieldValue) ? fieldValue : {};
  const userField = isRecord(userFieldValue) ? userFieldValue : {};
  const type = asString(userField.USER_TYPE_ID) ?? asString(field.type);
  if (!type) return null;
  const items = parseItems(userField.LIST);
  return {
    name,
    type,
    multiple: userField.MULTIPLE !== undefined
      ? asBoolean(userField.MULTIPLE)
      : asBoolean(field.isMultiple),
    required: asBoolean(field.isRequired) || asBoolean(userField.MANDATORY),
    items: items.length > 0 ? items : parseItems(field.items),
  };
}

function enumMatches(
  actual: BitrixFieldMetadata | undefined,
  expected: readonly { readonly id: number; readonly value: string }[],
): boolean {
  if (!actual || actual.type !== "enumeration") return false;
  return expected.every((expectedItem) => {
    const actualItem = actual.items.find((item) => item.id === expectedItem.id);
    return actualItem !== undefined &&
      normalizeLabel(actualItem.value) === normalizeLabel(expectedItem.value);
  });
}

async function collectList(
  client: BitrixClient,
  method: string,
  parameters: Record<string, unknown> = {},
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let start = 0;
  for (let page = 0; page < 20; page += 1) {
    const response = await client.call(method, { ...parameters, start });
    if (!Array.isArray(response.result)) {
      throw new BitrixSyncError("BITRIX_INVALID_LIST_RESPONSE", "retryable_failed");
    }
    rows.push(...response.result);
    if (response.next === undefined) return rows;
    start = response.next;
  }
  throw new BitrixSyncError("BITRIX_PAGINATION_LIMIT", "permanent_failed");
}

export function assertDiscoveryReady(
  configuration: BitrixDiscoveryConfiguration,
): void {
  const failed = Object.entries(configuration.checks).find(([, passed]) => !passed);
  if (failed) {
    throw new BitrixSyncError(failed[0], "blocked");
  }
}

export async function discoverBitrix(
  client: BitrixClient,
): Promise<BitrixDiscoveryConfiguration> {
  const leadFieldsResponse = await client.call("crm.lead.fields");
  if (!isRecord(leadFieldsResponse.result)) {
    throw new BitrixSyncError("BITRIX_INVALID_FIELDS_RESPONSE", "retryable_failed");
  }
  const leadFields = leadFieldsResponse.result;
  const userFields = await collectList(client, "crm.lead.userfield.list", {
    order: { ID: "ASC" },
  });
  const userFieldsByName = new Map<string, unknown>();
  for (const value of userFields) {
    if (!isRecord(value)) continue;
    const name = asString(value.FIELD_NAME);
    if (name) userFieldsByName.set(name, value);
  }

  const metadata: Record<string, BitrixFieldMetadata> = {};
  for (const name of [...REQUIRED_STANDARD_LEAD_FIELDS, ...REQUIRED_CUSTOM_LEAD_FIELDS]) {
    const parsed = parseMetadata(name, leadFields[name], userFieldsByName.get(name));
    if (parsed) metadata[name] = parsed;
  }

  const sources = await collectList(client, "crm.status.list", {
    filter: { ENTITY_ID: "SOURCE" },
    order: { SORT: "ASC" },
  });
  const sourceExists = sources.some(
    (source) => isRecord(source) && source.STATUS_ID === "EXHIBITION",
  );
  const usersResponse = await client.call("user.get", {
    FILTER: { ACTIVE: true },
    start: 0,
  });

  const standardReady = REQUIRED_STANDARD_LEAD_FIELDS.every(
    (name) => metadata[name] !== undefined,
  );
  const teamsFieldsReady = REQUIRED_CUSTOM_LEAD_FIELDS.slice(-3).every(
    (name) => metadata[name] !== undefined,
  );
  const enumReady = Object.entries(EXPECTED_ENUMS).every(([name, expected]) =>
    enumMatches(metadata[name], expected),
  ) && sourceExists;

  return {
    fields: metadata,
    checks: {
      BITRIX_WEBHOOK_AUTH: true,
      BITRIX_REQUIRED_FIELDS: standardReady,
      BITRIX_ENUMS: enumReady,
      BITRIX_TEAMS_FIELDS: teamsFieldsReady,
      BITRIX_USER_DIRECTORY: Array.isArray(usersResponse.result),
    },
  };
}

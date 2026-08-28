import type {
  BitrixDiscoveryConfiguration,
  BitrixProtectedChecks,
  CrmSyncSummary,
} from "./types";

function pass(value: boolean): "PASS" | "FAIL" {
  return value ? "PASS" : "FAIL";
}

export function formatDiscoveryChecks(
  discovery: BitrixDiscoveryConfiguration,
): string {
  return Object.entries(discovery.checks)
    .map(([name, value]) => `${name}=${pass(value)}`)
    .join("\n");
}

export function formatCrmSyncSummary(summary: CrmSyncSummary): string {
  return [
    "BITRIX_SYNC_SUMMARY",
    `outbox_seen=${summary.outboxSeen}`,
    `created=${summary.created}`,
    `updated=${summary.updated}`,
    `recovered=${summary.recovered}`,
    `blocked=${summary.blocked}`,
    `failed=${summary.failed}`,
  ].join("\n");
}

export function formatProtectedChecks(checks: BitrixProtectedChecks): string {
  return Object.entries(checks)
    .map(([name, value]) => `${name}=${pass(value)}`)
    .join("\n");
}

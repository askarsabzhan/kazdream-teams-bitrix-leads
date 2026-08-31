export type LeadHeaderBadge = {
  key: "leadType" | "priority" | "crmStatus";
  value: string;
};

export function buildLeadHeaderBadges(values: {
  leadType: string | null | undefined;
  priority: string | null | undefined;
  crmStatus: string | null | undefined;
}): LeadHeaderBadge[] {
  return (Object.entries(values) as Array<[LeadHeaderBadge["key"], string | null | undefined]>)
    .filter((entry): entry is [LeadHeaderBadge["key"], string] => Boolean(entry[1]?.trim()))
    .map(([key, value]) => ({ key, value }));
}

export const LEAD_TYPES = ["partner", "customer"] as const;

export type LeadType = (typeof LEAD_TYPES)[number];

export const DUPLICATE_OWNER_POLICIES = ["latest_contributor"] as const;

export const LEAD_WITHOUT_CONTACTS_POLICIES = [
  "require_name_and_phone",
] as const;

export const LATE_UPDATE_POLICIES = ["update_crm"] as const;

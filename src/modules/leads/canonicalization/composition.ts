import { normalizeEmail, normalizePhone } from "../grouping/signals";

import type {
  CanonicalComposition,
  CanonicalField,
  CanonicalIdentityKey,
  CanonicalLeadPayload,
  EligibleCanonicalGroup,
} from "./types";

const CAMPAIGN = {
  exhibition: "Hannover Messe 2026",
  exhibitionBitrixId: 63,
  source: "EXHIBITION",
} as const;

export interface ExistingCanonicalIdentity {
  leadId: string;
  identityKeys: CanonicalIdentityKey[];
  nameKey: string | null;
  companyKey: string | null;
}

export type CanonicalMatchDecision =
  | { state: "create"; leadId: null }
  | { state: "match"; leadId: string }
  | { state: "identity_conflict"; leadId: null };

export function normalizeCanonicalText(value: string): string | null {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}&' -]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized.length >= 2 ? normalized : null;
}

export function candidateIdentityKeys(
  group: EligibleCanonicalGroup,
): CanonicalIdentityKey[] {
  const keys = new Map<string, CanonicalIdentityKey>();
  for (const phone of group.candidate.phones) {
    const normalizedValue = normalizePhone(phone.value);
    if (normalizedValue) {
      keys.set(`phone:${normalizedValue}`, { kind: "phone", normalizedValue });
    }
  }
  for (const email of group.candidate.emails) {
    const normalizedValue = normalizeEmail(email.value);
    if (normalizedValue) {
      keys.set(`email:${normalizedValue}`, { kind: "email", normalizedValue });
    }
  }
  return [...keys.values()].sort((left, right) =>
    `${left.kind}:${left.normalizedValue}`.localeCompare(
      `${right.kind}:${right.normalizedValue}`,
    ),
  );
}

export function candidateSecondaryKeys(group: EligibleCanonicalGroup): {
  nameKey: string | null;
  companyKey: string | null;
} {
  const fullName = group.candidate.person.fullName;
  const company = group.candidate.person.company;
  return {
    nameKey:
      fullName.status === "supported" && fullName.value !== null
        ? normalizeCanonicalText(fullName.value)
        : null,
    companyKey:
      company.status === "supported" && company.value !== null
        ? normalizeCanonicalText(company.value)
        : null,
  };
}

export function resolveCanonicalMatch(
  group: EligibleCanonicalGroup,
  existing: readonly ExistingCanonicalIdentity[],
): CanonicalMatchDecision {
  const candidateKeys = new Set(
    candidateIdentityKeys(group).map(
      (key) => `${key.kind}:${key.normalizedValue}`,
    ),
  );
  const secondary = candidateSecondaryKeys(group);
  const strongMatches = new Set<string>();
  const secondaryMatches = new Set<string>();
  for (const lead of existing) {
    if (
      lead.identityKeys.some((key) =>
        candidateKeys.has(`${key.kind}:${key.normalizedValue}`),
      )
    ) {
      strongMatches.add(lead.leadId);
    }
    if (
      secondary.nameKey !== null &&
      secondary.companyKey !== null &&
      lead.nameKey === secondary.nameKey &&
      lead.companyKey === secondary.companyKey
    ) {
      secondaryMatches.add(lead.leadId);
    }
  }
  if (strongMatches.size > 1 || secondaryMatches.size > 1) {
    return { state: "identity_conflict", leadId: null };
  }
  const strongLeadId = [...strongMatches][0] ?? null;
  const secondaryLeadId = [...secondaryMatches][0] ?? null;
  if (
    strongLeadId !== null &&
    secondaryLeadId !== null &&
    strongLeadId !== secondaryLeadId
  ) {
    return { state: "identity_conflict", leadId: null };
  }
  const leadId = strongLeadId ?? secondaryLeadId;
  return leadId === null
    ? { state: "create", leadId: null }
    : { state: "match", leadId };
}

function groupOrder(group: EligibleCanonicalGroup): string {
  const firstContribution = [...group.contributors].sort((left, right) =>
    `${left.sourceCreatedAt}:${left.teamsMessageId}`.localeCompare(
      `${right.sourceCreatedAt}:${right.teamsMessageId}`,
    ),
  )[0];
  return `${firstContribution?.sourceCreatedAt ?? ""}:${group.groupId}`;
}

function composeField(
  groups: readonly EligibleCanonicalGroup[],
  select: (group: EligibleCanonicalGroup) => {
    value: string | null;
    status: "supported" | "conflicted" | "uncertain";
  },
): CanonicalField {
  const supported = new Map<string, { value: string; groupIds: string[] }>();
  const conflictGroups: string[] = [];
  for (const group of groups) {
    const field = select(group);
    if (field.status === "conflicted") conflictGroups.push(group.groupId);
    if (field.status !== "supported" || field.value === null) continue;
    const key = normalizeCanonicalText(field.value);
    if (!key) continue;
    const existing = supported.get(key);
    if (existing) existing.groupIds.push(group.groupId);
    else supported.set(key, { value: field.value, groupIds: [group.groupId] });
  }
  if (supported.size === 1 && conflictGroups.length === 0) {
    const only = [...supported.values()][0]!;
    return { value: only.value, status: "supported", groupIds: only.groupIds };
  }
  if (supported.size > 1 || conflictGroups.length > 0) {
    return {
      value: null,
      status: "conflicted",
      groupIds: [
        ...new Set([
          ...conflictGroups,
          ...[...supported.values()].flatMap((value) => value.groupIds),
        ]),
      ].sort(),
    };
  }
  return { value: null, status: "uncertain", groupIds: [] };
}

function composeContactValues(
  groups: readonly EligibleCanonicalGroup[],
  kind: "phone" | "email",
): CanonicalLeadPayload["phones"] {
  const result = new Map<string, { value: string; normalizedValue: string; groupIds: string[] }>();
  for (const group of groups) {
    const values = kind === "phone" ? group.candidate.phones : group.candidate.emails;
    for (const item of values) {
      const normalizedValue =
        kind === "phone" ? normalizePhone(item.value) : normalizeEmail(item.value);
      if (!normalizedValue) continue;
      const existing = result.get(normalizedValue);
      if (existing) existing.groupIds.push(group.groupId);
      else result.set(normalizedValue, { value: item.value, normalizedValue, groupIds: [group.groupId] });
    }
  }
  return [...result.values()]
    .map((item) => ({ ...item, groupIds: [...new Set(item.groupIds)].sort() }))
    .sort((left, right) => left.normalizedValue.localeCompare(right.normalizedValue));
}

function composeTextValues(
  groups: readonly EligibleCanonicalGroup[],
  select: (group: EligibleCanonicalGroup) => readonly { value: string }[],
): Array<{ value: string; groupIds: string[] }> {
  const result = new Map<string, { value: string; groupIds: string[] }>();
  for (const group of groups) {
    for (const item of select(group)) {
      const key = normalizeCanonicalText(item.value);
      if (!key) continue;
      const existing = result.get(key);
      if (existing) existing.groupIds.push(group.groupId);
      else result.set(key, { value: item.value, groupIds: [group.groupId] });
    }
  }
  return [...result.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, item]) => ({ ...item, groupIds: [...new Set(item.groupIds)].sort() }));
}

export function composeCanonicalLead(
  inputGroups: readonly EligibleCanonicalGroup[],
): CanonicalComposition {
  if (inputGroups.length === 0) throw new Error("Canonical composition requires groups.");
  const groups = [...inputGroups].sort((left, right) =>
    groupOrder(left).localeCompare(groupOrder(right)),
  );
  const fullName = composeField(groups, (group) => group.candidate.person.fullName);
  const company = composeField(groups, (group) => group.candidate.person.company);
  const jobTitle = composeField(groups, (group) => group.candidate.person.jobTitle);
  const phones = composeContactValues(groups, "phone");
  const emails = composeContactValues(groups, "email");
  const partnerGroups = groups.filter(
    (group) =>
      group.candidate.leadType.reason === "EXPLICIT_PARTNER_INDICATOR" ||
      group.candidate.leadType.reason === "EXPLICIT_LEAD_TYPE_CONFLICT",
  );
  const explicitCustomerGroups = groups.filter(
    (group) =>
      group.candidate.leadType.reason === "EXPLICIT_CUSTOMER_INDICATOR" ||
      group.candidate.leadType.reason === "EXPLICIT_LEAD_TYPE_CONFLICT",
  );
  const leadType =
    partnerGroups.length > 0
      ? {
          value: "Partner" as const,
          status:
            explicitCustomerGroups.length > 0
              ? ("conflicted" as const)
              : ("supported" as const),
          groupIds: [...new Set([...partnerGroups, ...explicitCustomerGroups].map((group) => group.groupId))].sort(),
        }
      : explicitCustomerGroups.length > 0
        ? {
            value: "Customer" as const,
            status: "supported" as const,
            groupIds: explicitCustomerGroups.map((group) => group.groupId).sort(),
          }
        : {
            value: "Customer" as const,
            status: "defaulted" as const,
            groupIds: groups.map((group) => group.groupId).sort(),
          };
  const regionGroups = groups.filter((group) => group.candidate.region.value === "Europe");
  const priorityOrder = { High: 3, Medium: 2, Low: 1 } as const;
  const priorities = groups
    .filter((group) => group.candidate.priority.value !== null)
    .sort(
      (left, right) =>
        priorityOrder[right.candidate.priority.value!] -
        priorityOrder[left.candidate.priority.value!],
    );
  const priorityValue = priorities[0]?.candidate.priority.value ?? null;
  const facts = composeTextValues(groups, (group) =>
    group.candidate.facts.map((fact) => ({ value: fact.text })),
  ).map((item) => ({ text: item.value, groupIds: item.groupIds }));
  const payload: CanonicalLeadPayload = {
    person: { fullName, company, jobTitle },
    phones,
    emails,
    relationshipIndicators: composeTextValues(
      groups,
      (group) => group.candidate.relationshipIndicators,
    ),
    productInterests: composeTextValues(
      groups,
      (group) => group.candidate.productInterests,
    ),
    region: {
      value: regionGroups.length > 0 ? "Europe" : null,
      groupIds: regionGroups.map((group) => group.groupId).sort(),
    },
    priority: {
      value: priorityValue,
      groupIds: priorities
        .filter((group) => group.candidate.priority.value === priorityValue)
        .map((group) => group.groupId)
        .sort(),
    },
    facts,
    leadType,
    campaign: CAMPAIGN,
  };
  const identityKeys = [
    ...phones.map(({ normalizedValue }) => ({ kind: "phone" as const, normalizedValue })),
    ...emails.map(({ normalizedValue }) => ({ kind: "email" as const, normalizedValue })),
  ].sort((left, right) =>
    `${left.kind}:${left.normalizedValue}`.localeCompare(
      `${right.kind}:${right.normalizedValue}`,
    ),
  );
  return {
    payload,
    identityKeys,
    nameKey: fullName.value ? normalizeCanonicalText(fullName.value) : null,
    companyKey: company.value ? normalizeCanonicalText(company.value) : null,
  };
}

import { z } from "zod";

import {
  extractGroupingSignals,
  normalizeEmail,
  normalizePhone,
} from "../grouping/signals";

import {
  PRODUCT_INTEREST_VALUES,
  rawGroupExtractionSchema,
  type RawGroupExtraction,
} from "./schema";
import {
  GroupExtractionError,
  type CandidateField,
  type CandidateListValue,
  type GroupCandidatePayload,
  type GroupEvidenceItem,
  type GroupExtractionChecks,
  type GroupExtractionVerificationSnapshot,
  type GroupFieldEvidenceWrite,
  type ValidatedGroupExtraction,
} from "./types";

const CAMPAIGN = {
  exhibition: "Hannover Messe 2026",
  exhibitionBitrixId: 63,
  source: "EXHIBITION",
} as const;

const PRODUCT_SET = new Set<string>(PRODUCT_INTEREST_VALUES);
const EUROPE_PATTERN =
  /\b(?:europe|european|eu|germany|deutschland|hannover|france|italy|spain|poland|netherlands|belgium|austria|switzerland|sweden|norway|denmark|finland|ireland|portugal|czechia|czech republic|slovakia|hungary|romania|bulgaria|croatia|slovenia|estonia|latvia|lithuania|greece)\b|(?:европ|германи|ганновер)/iu;
const PRIORITY_PATTERN =
  /\b(?:urgent|urgently|asap|immediately|priority|deadline|today|tomorrow|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|(?:срочн|немедленн|приоритет|дедлайн|сегодня|завтра|до\s+(?:понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья))/iu;
const PARTNER_TERM_PATTERN =
  /\b(?:partner|integrator|system\s+integrator|seller|distributor|dealer)\b|(?:партн[её]р|интегратор|системн(?:ый|ого|ому)?\s+интегратор|селлер|дистрибьютор|дилер)/giu;
const CUSTOMER_TERM_PATTERN =
  /\b(?:customer|client|end\s+user)\b|(?:клиент|заказчик|конечн(?:ый|ого|ому)?\s+пользователь)/giu;

const productPatterns: Record<(typeof PRODUCT_INTEREST_VALUES)[number], RegExp> = {
  "Platform/Core": /\b(?:platform|core)\b|(?:платформ|ядр)/iu,
  Analytics: /\b(?:analytics|analysis|bi)\b|(?:аналитик)/iu,
  "Integration Services": /\b(?:integration|integrating|api)\b|(?:интеграц)/iu,
  "Support & SLA": /\b(?:support|sla|service level)\b|(?:поддержк|уровень сервиса)/iu,
  Training: /\b(?:training|workshop|education)\b|(?:обучени|тренинг)/iu,
  "OEM/White label": /\b(?:oem|white[ -]?label)\b|(?:бел(?:ая|ой)\s+метк)/iu,
};

const evidenceIdSchema = z
  .string()
  .regex(/^(?:msg:\d+:text|att:\d+:(?:transcript|ocr))$/u);
const finalFieldSchema = z
  .object({
    value: z.string().nullable(),
    evidenceIds: z.array(evidenceIdSchema),
    status: z.enum(["supported", "conflicted", "uncertain"]),
  })
  .strict();
const finalListSchema = z
  .object({ value: z.string(), evidenceIds: z.array(evidenceIdSchema) })
  .strict();

export const groupCandidatePayloadSchema = z
  .object({
    person: z
      .object({
        fullName: finalFieldSchema,
        company: finalFieldSchema,
        jobTitle: finalFieldSchema,
      })
      .strict(),
    phones: z.array(finalListSchema),
    emails: z.array(finalListSchema),
    relationshipIndicators: z.array(finalListSchema),
    productInterests: z.array(
      z
        .object({
          value: z.enum(PRODUCT_INTEREST_VALUES),
          evidenceIds: z.array(evidenceIdSchema),
        })
        .strict(),
    ),
    region: z
      .object({
        value: z.literal("Europe").nullable(),
        evidenceIds: z.array(evidenceIdSchema),
        status: z.enum(["supported", "uncertain"]),
      })
      .strict(),
    priority: z
      .object({
        value: z.enum(["High", "Medium", "Low"]).nullable(),
        evidenceIds: z.array(evidenceIdSchema),
        status: z.enum(["supported", "uncertain"]),
      })
      .strict(),
    facts: z.array(
      z
        .object({ text: z.string(), evidenceIds: z.array(evidenceIdSchema) })
        .strict(),
    ),
    leadType: z
      .object({
        value: z.enum(["Partner", "Customer"]),
        evidenceIds: z.array(evidenceIdSchema),
        reason: z.enum([
          "EXPLICIT_PARTNER_INDICATOR",
          "EXPLICIT_CUSTOMER_INDICATOR",
          "EXPLICIT_LEAD_TYPE_CONFLICT",
          "CUSTOMER_DEFAULT",
        ]),
      })
      .strict(),
    campaign: z
      .object({
        exhibition: z.literal("Hannover Messe 2026"),
        exhibitionBitrixId: z.literal(63),
        source: z.literal("EXHIBITION"),
      })
      .strict(),
    eligibility: z
      .object({
        state: z.enum(["eligible", "not_eligible"]),
        reasonCode: z
          .enum([
            "MISSING_FULL_NAME",
            "MISSING_PHONE",
            "CONFLICTED_FULL_NAME",
          ])
          .nullable(),
      })
      .strict(),
  })
  .strict();

function decodeBasicHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p\s*>/giu, "\n")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

function normalizeText(value: string): string {
  return decodeBasicHtml(value)
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}@+&.' -]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isReliableFullName(value: string): boolean {
  const nameParts = normalizeText(value)
    .split(/[\s-]+/u)
    .filter(
      (part) =>
        /^[\p{L}.']+$/u.test(part) &&
        part.replace(/[.']/gu, "").length >= 2,
    );
  return nameParts.length >= 2;
}

function hasPositiveIndicator(value: string, pattern: RegExp): boolean {
  const text = decodeBasicHtml(value).normalize("NFKC");
  for (const match of text.matchAll(pattern)) {
    const prefix = text.slice(Math.max(0, (match.index ?? 0) - 48), match.index);
    const negated =
      /(?:\bnot|\bno\s+longer|\bno|\bnever|\bне|не\s+явля(?:юсь|емся|ется))\s+(?:an?\s+)?$/iu.test(
        prefix,
      );
    if (!negated) return true;
  }
  return false;
}

function hasExplicitPartnerIndicator(value: string): boolean {
  return hasPositiveIndicator(value, PARTNER_TERM_PATTERN);
}

function hasExplicitCustomerIndicator(value: string): boolean {
  return hasPositiveIndicator(value, CUSTOMER_TERM_PATTERN);
}

function uniqueValidReferences(
  values: readonly string[],
  evidence: ReadonlyMap<string, GroupEvidenceItem>,
): string[] {
  return [...new Set(values)].filter((value) => evidence.has(value));
}

function referenceSupportsText(
  value: string,
  evidenceId: string,
  evidence: ReadonlyMap<string, GroupEvidenceItem>,
): boolean {
  const source = evidence.get(evidenceId);
  const normalizedValue = normalizeText(value);
  return (
    normalizedValue.length >= 2 &&
    source !== undefined &&
    normalizeText(source.text).includes(normalizedValue)
  );
}

function validatedTextField(
  field: RawGroupExtraction["person"]["full_name"],
  evidence: ReadonlyMap<string, GroupEvidenceItem>,
): CandidateField {
  const validIds = uniqueValidReferences(field.evidence_ids, evidence);
  if (field.status === "conflicted") {
    return {
      value: null,
      evidenceIds: validIds,
      status: validIds.length >= 2 ? "conflicted" : "uncertain",
    };
  }
  if (field.status !== "supported" || field.value === null) {
    return { value: null, evidenceIds: [], status: "uncertain" };
  }
  const supportedIds = validIds.filter((id) =>
    referenceSupportsText(field.value ?? "", id, evidence),
  );
  return supportedIds.length > 0
    ? { value: field.value, evidenceIds: supportedIds, status: "supported" }
    : { value: null, evidenceIds: [], status: "uncertain" };
}

function deterministicLabeledConflict(
  evidenceItems: readonly GroupEvidenceItem[],
  signal: "nameHints" | "companyHints",
): string[] {
  const hints = new Set<string>();
  const supportingIds: string[] = [];
  for (const item of evidenceItems) {
    const itemHints = extractGroupingSignals([item.text])[signal];
    if (itemHints.size > 0) supportingIds.push(item.id);
    for (const hint of itemHints) hints.add(hint);
  }
  return hints.size > 1 ? [...new Set(supportingIds)] : [];
}

function validatedPhones(
  values: readonly { value: string; evidence_ids: string[] }[],
  evidence: ReadonlyMap<string, GroupEvidenceItem>,
): CandidateListValue[] {
  const result = new Map<string, CandidateListValue>();
  for (const item of values) {
    const normalized = normalizePhone(item.value);
    if (!normalized) continue;
    const validIds = uniqueValidReferences(item.evidence_ids, evidence).filter(
      (id) => {
        const source = evidence.get(id);
        return (
          source !== undefined &&
          extractGroupingSignals([source.text]).phones.has(normalized)
        );
      },
    );
    if (validIds.length === 0) continue;
    const existing = result.get(normalized);
    if (existing) {
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...validIds])];
    } else {
      result.set(normalized, { value: item.value, evidenceIds: validIds });
    }
  }
  return [...result.values()];
}

function validatedEmails(
  values: readonly { value: string; evidence_ids: string[] }[],
  evidence: ReadonlyMap<string, GroupEvidenceItem>,
): CandidateListValue[] {
  const result = new Map<string, CandidateListValue>();
  for (const item of values) {
    const normalized = normalizeEmail(item.value);
    if (!normalized) continue;
    const validIds = uniqueValidReferences(item.evidence_ids, evidence).filter(
      (id) => {
        const source = evidence.get(id);
        return (
          source !== undefined &&
          extractGroupingSignals([source.text]).emails.has(normalized)
        );
      },
    );
    if (validIds.length === 0) continue;
    const existing = result.get(normalized);
    if (existing) {
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...validIds])];
    } else {
      result.set(normalized, { value: item.value, evidenceIds: validIds });
    }
  }
  return [...result.values()];
}

function validatedTextList(
  values: readonly { value: string; evidence_ids: string[] }[],
  evidence: ReadonlyMap<string, GroupEvidenceItem>,
): CandidateListValue[] {
  const result = new Map<string, CandidateListValue>();
  for (const item of values) {
    const key = normalizeText(item.value);
    if (!key) continue;
    const validIds = uniqueValidReferences(item.evidence_ids, evidence).filter(
      (id) => referenceSupportsText(item.value, id, evidence),
    );
    if (validIds.length === 0) continue;
    const existing = result.get(key);
    if (existing) {
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...validIds])];
    } else {
      result.set(key, { value: item.value, evidenceIds: validIds });
    }
  }
  return [...result.values()];
}

function validatedProducts(
  values: readonly { value: string; evidence_ids: string[] }[],
  evidence: ReadonlyMap<string, GroupEvidenceItem>,
): CandidateListValue[] {
  const result: CandidateListValue[] = [];
  for (const item of values) {
    if (!PRODUCT_SET.has(item.value)) continue;
    const pattern = productPatterns[item.value as keyof typeof productPatterns];
    const validIds = uniqueValidReferences(item.evidence_ids, evidence).filter(
      (id) => pattern.test(evidence.get(id)?.text ?? ""),
    );
    if (validIds.length > 0 && !result.some((value) => value.value === item.value)) {
      result.push({ value: item.value, evidenceIds: validIds });
    }
  }
  return result;
}

function validatedContextValue<T extends string>(options: {
  value: T | null;
  status: "supported" | "uncertain";
  evidenceIds: readonly string[];
  evidence: ReadonlyMap<string, GroupEvidenceItem>;
  pattern: RegExp;
}): { value: T | null; evidenceIds: string[]; status: "supported" | "uncertain" } {
  if (options.status !== "supported" || options.value === null) {
    return { value: null, evidenceIds: [], status: "uncertain" };
  }
  const validIds = uniqueValidReferences(options.evidenceIds, options.evidence).filter(
    (id) => options.pattern.test(options.evidence.get(id)?.text ?? ""),
  );
  return validIds.length > 0
    ? { value: options.value, evidenceIds: validIds, status: "supported" }
    : { value: null, evidenceIds: [], status: "uncertain" };
}

function validatedFacts(
  facts: RawGroupExtraction["facts"],
  evidence: ReadonlyMap<string, GroupEvidenceItem>,
): Array<{ text: string; evidenceIds: string[] }> {
  return facts.flatMap((fact) => {
    const factTokens = new Set(
      normalizeText(fact.text)
        .split(" ")
        .filter((token) => token.length >= 4),
    );
    const validIds = uniqueValidReferences(fact.evidence_ids, evidence).filter(
      (id) => {
        const source = normalizeText(evidence.get(id)?.text ?? "");
        return [...factTokens].some((token) => source.includes(token));
      },
    );
    return validIds.length > 0 ? [{ text: fact.text, evidenceIds: validIds }] : [];
  });
}

function sourceFor(
  evidence: ReadonlyMap<string, GroupEvidenceItem>,
  evidenceId: string,
): GroupEvidenceItem | undefined {
  return evidence.get(evidenceId);
}

function evidenceRowsForValue(options: {
  fieldName: string;
  value: string | null;
  normalizedValue: string;
  evidenceIds: readonly string[];
  evidence: ReadonlyMap<string, GroupEvidenceItem>;
  status: "accepted" | "conflicted";
}): GroupFieldEvidenceWrite[] {
  return options.evidenceIds.flatMap((evidenceRefId) => {
    const source = sourceFor(options.evidence, evidenceRefId);
    return source
      ? [
          {
            fieldName: options.fieldName,
            valueJson: { value: options.value },
            normalizedValue: options.normalizedValue,
            evidenceRefId,
            teamsMessageId: source.teamsMessageId,
            attachmentId: source.attachmentId,
            method: source.type,
            validationStatus: options.status,
          },
        ]
      : [];
  });
}

function buildFieldEvidence(
  candidate: GroupCandidatePayload,
  evidence: ReadonlyMap<string, GroupEvidenceItem>,
): GroupFieldEvidenceWrite[] {
  const rows: GroupFieldEvidenceWrite[] = [];
  for (const [fieldName, field] of [
    ["person.full_name", candidate.person.fullName],
    ["person.company", candidate.person.company],
    ["person.job_title", candidate.person.jobTitle],
  ] as const) {
    if (field.status === "supported" && field.value !== null) {
      rows.push(
        ...evidenceRowsForValue({
          fieldName,
          value: field.value,
          normalizedValue: normalizeText(field.value),
          evidenceIds: field.evidenceIds,
          evidence,
          status: "accepted",
        }),
      );
    } else if (field.status === "conflicted") {
      rows.push(
        ...evidenceRowsForValue({
          fieldName,
          value: null,
          normalizedValue: "conflicted",
          evidenceIds: field.evidenceIds,
          evidence,
          status: "conflicted",
        }),
      );
    }
  }
  for (const [fieldName, values, normalize] of [
    ["phones", candidate.phones, (value: string) => normalizePhone(value) ?? ""],
    ["emails", candidate.emails, (value: string) => normalizeEmail(value) ?? ""],
    ["relationship_indicators", candidate.relationshipIndicators, normalizeText],
    ["product_interests", candidate.productInterests, normalizeText],
  ] as const) {
    for (const value of values) {
      rows.push(
        ...evidenceRowsForValue({
          fieldName,
          value: value.value,
          normalizedValue: normalize(value.value),
          evidenceIds: value.evidenceIds,
          evidence,
          status: "accepted",
        }),
      );
    }
  }
  for (const [fieldName, field] of [
    ["region", candidate.region],
    ["priority", candidate.priority],
  ] as const) {
    if (field.value !== null && field.status === "supported") {
      rows.push(
        ...evidenceRowsForValue({
          fieldName,
          value: field.value,
          normalizedValue: normalizeText(field.value),
          evidenceIds: field.evidenceIds,
          evidence,
          status: "accepted",
        }),
      );
    }
  }
  for (const fact of candidate.facts) {
    rows.push(
      ...evidenceRowsForValue({
        fieldName: "facts",
        value: fact.text,
        normalizedValue: normalizeText(fact.text),
        evidenceIds: fact.evidenceIds,
        evidence,
        status: "accepted",
      }),
    );
  }
  if (candidate.leadType.reason === "EXPLICIT_PARTNER_INDICATOR") {
    rows.push(
      ...evidenceRowsForValue({
        fieldName: "lead_type",
        value: "Partner",
        normalizedValue: "partner",
        evidenceIds: candidate.leadType.evidenceIds,
        evidence,
        status: "accepted",
      }),
    );
  } else if (candidate.leadType.reason === "EXPLICIT_CUSTOMER_INDICATOR") {
    rows.push(
      ...evidenceRowsForValue({
        fieldName: "lead_type",
        value: "Customer",
        normalizedValue: "customer",
        evidenceIds: candidate.leadType.evidenceIds,
        evidence,
        status: "accepted",
      }),
    );
  } else {
    if (candidate.leadType.reason === "EXPLICIT_LEAD_TYPE_CONFLICT") {
      rows.push(
        ...evidenceRowsForValue({
          fieldName: "lead_type",
          value: null,
          normalizedValue: "conflicted",
          evidenceIds: candidate.leadType.evidenceIds,
          evidence,
          status: "conflicted",
        }),
      );
    }
    rows.push({
      fieldName: "lead_type",
      valueJson: { value: "Customer" },
      normalizedValue: "customer",
      evidenceRefId: "system:customer-default",
      teamsMessageId: null,
      attachmentId: null,
      method: "system_default",
      validationStatus: "accepted",
    });
  }
  rows.push(
    {
      fieldName: "campaign.exhibition",
      valueJson: { value: CAMPAIGN.exhibition, bitrixId: CAMPAIGN.exhibitionBitrixId },
      normalizedValue: "hannover_messe_2026",
      evidenceRefId: "system:campaign",
      teamsMessageId: null,
      attachmentId: null,
      method: "system_default",
      validationStatus: "accepted",
    },
    {
      fieldName: "campaign.source",
      valueJson: { value: CAMPAIGN.source },
      normalizedValue: "exhibition",
      evidenceRefId: "system:campaign",
      teamsMessageId: null,
      attachmentId: null,
      method: "system_default",
      validationStatus: "accepted",
    },
  );
  return rows;
}

export function validateGroupExtraction(
  rawValue: unknown,
  evidenceItems: readonly GroupEvidenceItem[],
): ValidatedGroupExtraction {
  let raw: RawGroupExtraction;
  try {
    raw = rawGroupExtractionSchema.parse(rawValue);
  } catch {
    throw new GroupExtractionError("OPENAI_INVALID_OUTPUT", "permanent_failed");
  }
  const evidence = new Map(evidenceItems.map((item) => [item.id, item]));
  let fullName = validatedTextField(raw.person.full_name, evidence);
  if (
    fullName.status === "supported" &&
    fullName.value !== null &&
    !isReliableFullName(fullName.value)
  ) {
    fullName = { value: null, evidenceIds: [], status: "uncertain" };
  }
  const deterministicConflictIds = deterministicLabeledConflict(
    evidenceItems,
    "nameHints",
  );
  if (deterministicConflictIds.length >= 2) {
    fullName = {
      value: null,
      evidenceIds: deterministicConflictIds,
      status: "conflicted",
    };
  }
  let company = validatedTextField(raw.person.company, evidence);
  const deterministicCompanyConflictIds = deterministicLabeledConflict(
    evidenceItems,
    "companyHints",
  );
  if (deterministicCompanyConflictIds.length >= 2) {
    company = {
      value: null,
      evidenceIds: deterministicCompanyConflictIds,
      status: "conflicted",
    };
  }
  const jobTitle = validatedTextField(raw.person.job_title, evidence);
  const phones = validatedPhones(raw.phones, evidence);
  const emails = validatedEmails(raw.emails, evidence);
  const relationshipIndicators = validatedTextList(
    raw.relationship_indicators,
    evidence,
  );
  const productInterests = validatedProducts(raw.product_interests, evidence);
  const region = validatedContextValue({
    value: raw.region.value === "Europe" ? raw.region.value : null,
    status: raw.region.status,
    evidenceIds: raw.region.evidence_ids,
    evidence,
    pattern: EUROPE_PATTERN,
  });
  const priority = validatedContextValue({
    value:
      raw.priority.value === "High" ||
      raw.priority.value === "Medium" ||
      raw.priority.value === "Low"
        ? raw.priority.value
        : null,
    status: raw.priority.status,
    evidenceIds: raw.priority.evidence_ids,
    evidence,
    pattern: PRIORITY_PATTERN,
  });
  const facts = validatedFacts(raw.facts, evidence);

  const partnerEvidenceIds = evidenceItems
    .filter((item) => hasExplicitPartnerIndicator(item.text))
    .map((item) => item.id);
  const customerEvidenceIds = evidenceItems
    .filter((item) => hasExplicitCustomerIndicator(item.text))
    .map((item) => item.id);
  const leadType =
    partnerEvidenceIds.length > 0 && customerEvidenceIds.length > 0
      ? {
          value: "Customer" as const,
          evidenceIds: [...new Set([...partnerEvidenceIds, ...customerEvidenceIds])],
          reason: "EXPLICIT_LEAD_TYPE_CONFLICT" as const,
        }
      : partnerEvidenceIds.length > 0
      ? {
          value: "Partner" as const,
          evidenceIds: partnerEvidenceIds,
          reason: "EXPLICIT_PARTNER_INDICATOR" as const,
        }
      : customerEvidenceIds.length > 0
        ? {
            value: "Customer" as const,
            evidenceIds: customerEvidenceIds,
            reason: "EXPLICIT_CUSTOMER_INDICATOR" as const,
          }
      : {
          value: "Customer" as const,
          evidenceIds: [],
          reason: "CUSTOMER_DEFAULT" as const,
        };

  const eligibility =
    fullName.status === "conflicted"
      ? { state: "not_eligible" as const, reasonCode: "CONFLICTED_FULL_NAME" as const }
      : fullName.value === null
        ? { state: "not_eligible" as const, reasonCode: "MISSING_FULL_NAME" as const }
        : phones.length === 0
          ? { state: "not_eligible" as const, reasonCode: "MISSING_PHONE" as const }
          : { state: "eligible" as const, reasonCode: null };

  const candidate: GroupCandidatePayload = {
    person: { fullName, company, jobTitle },
    phones,
    emails,
    relationshipIndicators,
    productInterests,
    region,
    priority,
    facts,
    leadType,
    campaign: CAMPAIGN,
    eligibility,
  };
  return { candidate, fieldEvidence: buildFieldEvidence(candidate, evidence) };
}

function factualEvidenceIds(candidate: GroupCandidatePayload): string[] {
  return [
    ...candidate.person.fullName.evidenceIds,
    ...candidate.person.company.evidenceIds,
    ...candidate.person.jobTitle.evidenceIds,
    ...candidate.phones.flatMap((value) => value.evidenceIds),
    ...candidate.emails.flatMap((value) => value.evidenceIds),
    ...candidate.relationshipIndicators.flatMap((value) => value.evidenceIds),
    ...candidate.productInterests.flatMap((value) => value.evidenceIds),
    ...candidate.region.evidenceIds,
    ...candidate.priority.evidenceIds,
    ...candidate.facts.flatMap((value) => value.evidenceIds),
    ...candidate.leadType.evidenceIds,
  ];
}

function hasSupportedRequiredContact(snapshot: GroupExtractionVerificationSnapshot): boolean {
  return (
    snapshot.candidate.person.fullName.status === "supported" &&
    snapshot.candidate.person.fullName.value !== null &&
    isReliableFullName(snapshot.candidate.person.fullName.value) &&
    snapshot.candidate.phones.length > 0
  );
}

function expectedEligibility(candidate: GroupCandidatePayload): GroupCandidatePayload["eligibility"] {
  if (candidate.person.fullName.status === "conflicted") {
    return { state: "not_eligible", reasonCode: "CONFLICTED_FULL_NAME" };
  }
  if (
    candidate.person.fullName.value === null ||
    !isReliableFullName(candidate.person.fullName.value)
  ) {
    return { state: "not_eligible", reasonCode: "MISSING_FULL_NAME" };
  }
  if (candidate.phones.length === 0) {
    return { state: "not_eligible", reasonCode: "MISSING_PHONE" };
  }
  return { state: "eligible", reasonCode: null };
}

function hasEvidenceRow(
  snapshot: GroupExtractionVerificationSnapshot,
  predicate: (row: GroupExtractionVerificationSnapshot["fieldEvidence"][number]) => boolean,
): boolean {
  return snapshot.fieldEvidence.some(
    (row) => row.extractionRevision === snapshot.extractionRevision && predicate(row),
  );
}

function customerProvenanceIsValid(
  snapshot: GroupExtractionVerificationSnapshot,
): boolean {
  const reason = snapshot.candidate.leadType.reason;
  const defaultRow = hasEvidenceRow(
    snapshot,
    (row) =>
      row.fieldName === "lead_type" &&
      row.evidenceRefId === "system:customer-default" &&
      row.method === "system_default" &&
      row.validationStatus === "accepted" &&
      row.teamsMessageId === null &&
      row.attachmentId === null,
  );
  const citedRows = snapshot.candidate.leadType.evidenceIds.every((evidenceId) =>
    hasEvidenceRow(
      snapshot,
      (row) =>
        row.fieldName === "lead_type" &&
        row.evidenceRefId === evidenceId &&
        row.method !== "system_default" &&
        row.validationStatus ===
          (reason === "EXPLICIT_LEAD_TYPE_CONFLICT" ? "conflicted" : "accepted"),
    ),
  );
  if (reason === "CUSTOMER_DEFAULT") {
    return snapshot.candidate.leadType.value === "Customer" && defaultRow;
  }
  if (reason === "EXPLICIT_LEAD_TYPE_CONFLICT") {
    return (
      snapshot.candidate.leadType.value === "Customer" && defaultRow && citedRows
    );
  }
  if (reason === "EXPLICIT_CUSTOMER_INDICATOR") {
    return (
      snapshot.candidate.leadType.value === "Customer" && !defaultRow && citedRows
    );
  }
  return snapshot.candidate.leadType.value === "Partner" && !defaultRow;
}

function campaignConfigIsValid(snapshot: GroupExtractionVerificationSnapshot): boolean {
  const campaign = snapshot.candidate.campaign;
  const campaignRows = snapshot.fieldEvidence.filter(
    (row) =>
      row.extractionRevision === snapshot.extractionRevision &&
      row.evidenceRefId === "system:campaign" &&
      row.method === "system_default" &&
      row.validationStatus === "accepted" &&
      row.teamsMessageId === null &&
      row.attachmentId === null,
  );
  return (
    campaign.exhibition === CAMPAIGN.exhibition &&
    campaign.exhibitionBitrixId === CAMPAIGN.exhibitionBitrixId &&
    campaign.source === CAMPAIGN.source &&
    campaignRows.length === 2 &&
    campaignRows.some((row) => row.fieldName === "campaign.exhibition") &&
    campaignRows.some((row) => row.fieldName === "campaign.source")
  );
}

function contactValuesHaveSourceSupport(
  snapshot: GroupExtractionVerificationSnapshot,
): boolean {
  const evidence = new Map(snapshot.evidenceItems.map((item) => [item.id, item]));
  const name = snapshot.candidate.person.fullName;
  if (
    name.value !== null &&
    !name.evidenceIds.some((id) => referenceSupportsText(name.value ?? "", id, evidence))
  ) {
    return false;
  }
  for (const phone of snapshot.candidate.phones) {
    const normalized = normalizePhone(phone.value);
    if (
      !normalized ||
      !phone.evidenceIds.some((id) => {
        const source = evidence.get(id);
        return source && extractGroupingSignals([source.text]).phones.has(normalized);
      })
    ) {
      return false;
    }
  }
  for (const email of snapshot.candidate.emails) {
    const normalized = normalizeEmail(email.value);
    if (
      !normalized ||
      !email.evidenceIds.some((id) => {
        const source = evidence.get(id);
        return source && extractGroupingSignals([source.text]).emails.has(normalized);
      })
    ) {
      return false;
    }
  }
  return true;
}

export function evaluateGroupExtractionChecks(
  snapshots: readonly GroupExtractionVerificationSnapshot[],
): GroupExtractionChecks {
  const sorted = [...snapshots].sort((left, right) =>
    left.groupId.localeCompare(right.groupId),
  );
  const evidenceReferences = sorted.every((snapshot) => {
    const allowed = new Set(snapshot.evidenceItems.map((item) => item.id));
    return factualEvidenceIds(snapshot.candidate).every((id) => allowed.has(id));
  });
  const partnerSnapshots = sorted.filter(
    (snapshot) => snapshot.candidate.leadType.value === "Partner",
  );
  const customerSnapshots = sorted.filter(
    (snapshot) => snapshot.candidate.leadType.value === "Customer",
  );
  const partnerRule =
    partnerSnapshots.length >= 1 &&
    customerSnapshots.length >= 1 &&
    partnerSnapshots.every((snapshot) => {
      const evidence = new Map(snapshot.evidenceItems.map((item) => [item.id, item]));
      return snapshot.candidate.leadType.evidenceIds.some((id) =>
        hasExplicitPartnerIndicator(evidence.get(id)?.text ?? ""),
      );
    });
  return {
    groupARequiredContact: sorted[0] ? hasSupportedRequiredContact(sorted[0]) : false,
    groupBRequiredContact: sorted[1] ? hasSupportedRequiredContact(sorted[1]) : false,
    partnerRule,
    evidenceReferences,
    noHallucinatedContact: sorted.every(contactValuesHaveSourceSupport),
    eligibilityRule: sorted.every(
      (snapshot) =>
        JSON.stringify(snapshot.candidate.eligibility) ===
        JSON.stringify(expectedEligibility(snapshot.candidate)),
    ),
    customerDefaultProvenance: sorted.every(customerProvenanceIsValid),
    campaignConfig: sorted.every(campaignConfigIsValid),
  };
}

import { BitrixSyncError } from "./errors";
import type {
  BitrixDiscoveryConfiguration,
  BitrixFieldMetadata,
  BitrixLeadFields,
  CrmSyncClaim,
} from "./types";

const LEAD_TYPE_IDS = { Partner: 45, Customer: 47 } as const;
const PRODUCT_IDS = {
  "Platform/Core": 71,
  Analytics: 73,
  "Integration Services": 75,
  "Support & SLA": 77,
  Training: 79,
  "OEM/White label": 81,
} as const;
const PRIORITY_IDS = { High: 83, Medium: 85, Low: 87 } as const;
const MAX_SOURCE_COMMENT_LENGTH = 100_000;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function requiredField(
  configuration: BitrixDiscoveryConfiguration,
  name: string,
): BitrixFieldMetadata {
  const field = configuration.fields[name];
  if (!field) throw new BitrixSyncError("BITRIX_REQUIRED_FIELD_MISSING", "blocked");
  return field;
}

function customValue(
  metadata: BitrixFieldMetadata,
  scalar: string | number,
): string | number | readonly (string | number)[] {
  return metadata.multiple ? [scalar] : scalar;
}

function productId(value: string): (typeof PRODUCT_IDS)[keyof typeof PRODUCT_IDS] {
  if (!Object.hasOwn(PRODUCT_IDS, value)) {
    throw new BitrixSyncError("CANONICAL_PRODUCT_UNSUPPORTED", "blocked");
  }
  return PRODUCT_IDS[value as keyof typeof PRODUCT_IDS];
}

function sourceGroupValues(claim: CrmSyncClaim): string[] {
  return unique([
    claim.bitrixSourceGroupId,
    ...claim.groupIds.filter((groupId) => groupId !== claim.bitrixSourceGroupId),
  ]);
}

export function buildBitrixLeadFields(options: {
  claim: CrmSyncClaim;
  assignedBitrixUserId: number;
  managerEmail: string;
  discovery: BitrixDiscoveryConfiguration;
}): BitrixLeadFields {
  const { claim, discovery } = options;
  const candidate = claim.canonicalPayload;
  const name = candidate.person.fullName.status === "supported"
    ? candidate.person.fullName.value
    : null;
  if (!name || candidate.phones.length === 0) {
    throw new BitrixSyncError("CANONICAL_CRM_ELIGIBILITY_FAILED", "blocked");
  }
  const company = candidate.person.company.status === "supported"
    ? candidate.person.company.value
    : null;
  const jobTitle = candidate.person.jobTitle.status === "supported"
    ? candidate.person.jobTitle.value
    : null;
  const title = company ? `${name} — ${company}` : name;

  const fields: BitrixLeadFields = {
    TITLE: title,
    NAME: name,
    PHONE: candidate.phones.map((phone) => ({
      VALUE: phone.value,
      VALUE_TYPE: "WORK",
    })),
    COMMENTS: claim.summaryRu,
    SOURCE_ID: "EXHIBITION",
    ASSIGNED_BY_ID: options.assignedBitrixUserId,
    UF_CRM_LEAD_TYPE: LEAD_TYPE_IDS[candidate.leadType.value],
    UF_CRM_EXHIBITION: 63,
  };
  if (company) fields.COMPANY_TITLE = company;
  if (jobTitle) fields.POST = jobTitle;
  if (candidate.emails.length > 0) {
    fields.EMAIL = candidate.emails.map((email) => ({
      VALUE: email.value,
      VALUE_TYPE: "WORK",
    }));
  }
  if (candidate.region.value === "Europe") fields.UF_CRM_REGION = 49;
  if (candidate.priority.value !== null) {
    fields.UF_CRM_PRIORITY = PRIORITY_IDS[candidate.priority.value];
  }

  const productField = requiredField(discovery, "UF_CRM_PRODUCT_INTEREST");
  const productIds = candidate.productInterests.map((product) =>
    productId(product.value)
  );
  if (productIds.length > 1 && !productField.multiple) {
    throw new BitrixSyncError("BITRIX_PRODUCT_FIELD_LIMITATION", "blocked");
  }
  if (productIds.length > 0) {
    fields.UF_CRM_PRODUCT_INTEREST = productField.multiple
      ? productIds
      : productIds[0]!;
  }

  const groupField = requiredField(discovery, "UF_CRM_TEAMS_GROUP_ID");
  const groups = sourceGroupValues(claim);
  fields.UF_CRM_TEAMS_GROUP_ID = groupField.multiple ? groups : groups[0]!;

  const messageField = requiredField(discovery, "UF_CRM_TEAMS_MESSAGE_IDS");
  const messageIds = unique(claim.teamsMessageIds);
  fields.UF_CRM_TEAMS_MESSAGE_IDS = messageField.multiple
    ? messageIds
    : JSON.stringify(messageIds);

  const authorField = requiredField(discovery, "UF_CRM_TEAMS_AUTHOR");
  const authorValue = authorField.type === "employee" || authorField.type === "user"
    ? options.assignedBitrixUserId
    : options.managerEmail;
  fields.UF_CRM_TEAMS_AUTHOR = customValue(authorField, authorValue);
  return fields;
}

function teamsTextToPlainText(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/p\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .trim();
}

export function buildSourceTimelineComment(claim: CrmSyncClaim): string {
  const labels: Record<CrmSyncClaim["sourceEvidence"][number]["evidenceType"], string> = {
    teams_text: "Исходное сообщение Teams",
    reply_text: "Исходный ответ Teams",
    transcript: "Дословная транскрипция",
    ocr: "Распознанный текст вложения",
  };
  const blocks = claim.sourceEvidence.map((evidence, index) => {
    const text = evidence.evidenceType === "teams_text" || evidence.evidenceType === "reply_text"
      ? teamsTextToPlainText(evidence.text)
      : evidence.text;
    return `${index + 1}. ${labels[evidence.evidenceType]}\n${text}`;
  });
  const comment = [
    claim.sourceCommentMarker,
    "Исходные материалы менеджеров (отдельно от аналитического резюме):",
    ...blocks,
  ].join("\n\n");
  if (comment.length > MAX_SOURCE_COMMENT_LENGTH) {
    throw new BitrixSyncError("BITRIX_SOURCE_COMMENT_TOO_LARGE", "blocked");
  }
  return comment;
}

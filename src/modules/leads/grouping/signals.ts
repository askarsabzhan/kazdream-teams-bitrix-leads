export interface GroupingSignals {
  emails: Set<string>;
  phones: Set<string>;
  nameHints: Set<string>;
  companyHints: Set<string>;
}

const EMAIL_PATTERN =
  /(?<![a-z0-9._%+-])([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63})(?![a-z0-9._%+-])/giu;
const EMAIL_VALUE_PATTERN =
  /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/iu;
const PHONE_PATTERN =
  /(?<![\p{L}\p{N}])(\+?\d[\d\s().-]{5,}\d)(?![\p{L}\p{N}])/gu;

function emptySignals(): GroupingSignals {
  return {
    emails: new Set<string>(),
    phones: new Set<string>(),
    nameHints: new Set<string>(),
    companyHints: new Set<string>(),
  };
}

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

function normalizeHint(value: string): string | null {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}&' -]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length < 3 || normalized.length > 80) return null;
  return normalized;
}

function labeledHints(
  text: string,
  labels: readonly string[],
): Set<string> {
  const result = new Set<string>();
  const labelExpression = labels.join("|");
  const pattern = new RegExp(
    `(?:^|[\\n;])\\s*(?:${labelExpression})\\s*[:=–—-]\\s*([^\\n;]{2,80})`,
    "giu",
  );
  for (const match of text.matchAll(pattern)) {
    const value = normalizeHint(match[1] ?? "");
    if (value) result.add(value);
  }
  return result;
}

export function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLocaleLowerCase("und");
  return EMAIL_VALUE_PATTERN.test(normalized) ? normalized : null;
}

export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/gu, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${hasLeadingPlus ? "+" : ""}${digits}`;
}

export function extractGroupingSignals(
  evidenceTexts: readonly string[],
): GroupingSignals {
  const signals = emptySignals();
  for (const rawText of evidenceTexts) {
    const text = decodeBasicHtml(rawText).normalize("NFKC");
    for (const match of text.matchAll(EMAIL_PATTERN)) {
      const email = normalizeEmail(match[1] ?? "");
      if (email) signals.emails.add(email);
    }
    for (const match of text.matchAll(PHONE_PATTERN)) {
      const phone = normalizePhone(match[1] ?? "");
      if (phone) signals.phones.add(phone);
    }
    for (const value of labeledHints(text, [
      "name",
      "full\\s+name",
      "contact\\s+name",
      "имя",
      "фио",
    ])) {
      signals.nameHints.add(value);
    }
    for (const value of labeledHints(text, [
      "company",
      "organisation",
      "organization",
      "employer",
      "компания",
      "организация",
    ])) {
      signals.companyHints.add(value);
    }
  }
  return signals;
}

export function mergeGroupingSignals(
  target: GroupingSignals,
  source: GroupingSignals,
): void {
  for (const value of source.emails) target.emails.add(value);
  for (const value of source.phones) target.phones.add(value);
  for (const value of source.nameHints) target.nameHints.add(value);
  for (const value of source.companyHints) target.companyHints.add(value);
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

export function sharedSignalReason(
  left: GroupingSignals,
  right: GroupingSignals,
): "exact_email" | "exact_phone" | "name_company" | null {
  if (intersects(left.emails, right.emails)) return "exact_email";
  if (intersects(left.phones, right.phones)) return "exact_phone";
  if (
    intersects(left.nameHints, right.nameHints) &&
    intersects(left.companyHints, right.companyHints)
  ) {
    return "name_company";
  }
  return null;
}

export function hasStrongIdentity(signals: GroupingSignals): boolean {
  return (
    signals.emails.size > 0 ||
    signals.phones.size > 0 ||
    (signals.nameHints.size > 0 && signals.companyHints.size > 0)
  );
}

export type EvidenceMethod =
  | "teams_text"
  | "reply_text"
  | "transcript"
  | "ocr"
  | "system_default";

export type EvidenceSource =
  | "teams"
  | "reply"
  | "transcription"
  | "ocr"
  | "businessRule";

const methodSources: Record<EvidenceMethod, EvidenceSource> = {
  teams_text: "teams",
  reply_text: "reply",
  transcript: "transcription",
  ocr: "ocr",
  system_default: "businessRule",
};

const sourceOrder: EvidenceSource[] = [
  "teams",
  "reply",
  "transcription",
  "ocr",
  "businessRule",
];

export function evidenceSourceForMethod(method: string): EvidenceSource | null {
  return method in methodSources
    ? methodSources[method as EvidenceMethod]
    : null;
}

export function groupEvidenceSources(
  rows: readonly { fieldName: string; method: string }[],
): Record<string, EvidenceSource[]> {
  const grouped = new Map<string, Set<EvidenceSource>>();
  for (const row of rows) {
    const source = evidenceSourceForMethod(row.method);
    if (!source) continue;
    const current = grouped.get(row.fieldName) ?? new Set<EvidenceSource>();
    current.add(source);
    grouped.set(row.fieldName, current);
  }

  return Object.fromEntries(
    [...grouped].map(([fieldName, sources]) => [
      fieldName,
      sourceOrder.filter((source) => sources.has(source)),
    ]),
  );
}

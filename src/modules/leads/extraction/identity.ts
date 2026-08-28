import { createHash } from "node:crypto";

import type { GroupEvidenceItem } from "./types";

export function buildGroupExtractionIdentity(options: {
  groupId: string;
  groupingRevision: number;
  groupingAlgorithmVersion: string;
  evidenceItems: readonly GroupEvidenceItem[];
  providerName: string;
  providerModel: string;
  promptVersion: string;
  schemaVersion: string;
}): string {
  const contentHashes = options.evidenceItems.map((item) => ({
    id: item.id,
    type: item.type,
    sha256: createHash("sha256").update(item.text, "utf8").digest("hex"),
  }));
  return createHash("sha256")
    .update(
      JSON.stringify({
        groupId: options.groupId,
        groupingRevision: options.groupingRevision,
        groupingAlgorithmVersion: options.groupingAlgorithmVersion,
        contentHashes,
        providerName: options.providerName,
        providerModel: options.providerModel,
        promptVersion: options.promptVersion,
        schemaVersion: options.schemaVersion,
      }),
      "utf8",
    )
    .digest("hex");
}

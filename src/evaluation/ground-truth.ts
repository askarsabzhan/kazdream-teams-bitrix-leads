import type { CanonicalGroundTruth, EncounterGroundTruth } from "./types";

const customer = "Customer" as const;

export const ENCOUNTER_GROUND_TRUTH: EncounterGroundTruth[] = [
  ...Array.from({ length: 22 }, (_, index): EncounterGroundTruth[] => {
    const number = index + 1;
    const canonicalId = `canonical-${String(number).padStart(2, "0")}`;
    const baseManager = ["manager-a", "manager-a", "manager-b", "manager-c", "manager-c", "manager-c", "manager-a", "manager-a", "manager-b", "manager-c", "manager-a", "manager-b", "manager-c", "manager-a", "manager-a", "manager-b", "manager-c", "manager-a", "manager-b", "manager-e", "manager-c", "manager-d"][index]!;
    const encounterIds = number === 7
      ? ["enc-07-a", "enc-07-b"]
      : number === 15
        ? ["enc-15-a", "enc-15-b"]
        : number === 20
          ? ["enc-20-a", "enc-20-b"]
          : [`enc-${String(number).padStart(2, "0")}`];
    return encounterIds.map((encounterId, encounterIndex) => ({
      encounterId,
      canonicalId,
      eligible: true,
      leadType: number === 12 ? "Partner" : customer,
      managerId:
        number === 7 && encounterIndex === 1 ? "manager-b"
          : number === 15 && encounterIndex === 1 ? "manager-d"
            : number === 20 && encounterIndex === 1 ? "manager-f"
              : baseManager,
      fullNameStatus: "supported",
      phoneCount: number === 8 ? 2 : 1,
      emailCount:
        number === 11 || (number === 15 && encounterIndex === 0)
          ? 0
          : number === 9 ? 2 : 1,
    }));
  }).flat(),
  {
    encounterId: "ineligible-email-only",
    canonicalId: null,
    eligible: false,
    leadType: customer,
    managerId: "manager-a",
    fullNameStatus: "supported",
    phoneCount: 0,
    emailCount: 1,
  },
  {
    encounterId: "ineligible-missing-name",
    canonicalId: null,
    eligible: false,
    leadType: customer,
    managerId: "manager-b",
    fullNameStatus: "uncertain",
    phoneCount: 1,
    emailCount: 0,
  },
  {
    encounterId: "ineligible-name-conflict",
    canonicalId: null,
    eligible: false,
    leadType: customer,
    managerId: "manager-c",
    fullNameStatus: "conflicted",
    phoneCount: 1,
    emailCount: 0,
  },
];

export const CANONICAL_GROUND_TRUTH: CanonicalGroundTruth[] = Array.from(
  { length: 22 },
  (_, index) => {
    const number = index + 1;
    const defaultManagers = ["manager-a", "manager-a", "manager-b", "manager-c", "manager-c", "manager-c", "manager-b", "manager-a", "manager-b", "manager-c", "manager-a", "manager-b", "manager-c", "manager-a", "manager-d", "manager-b", "manager-c", "manager-a", "manager-b", "manager-f", "manager-c", "manager-d"];
    return {
      canonicalId: `canonical-${String(number).padStart(2, "0")}`,
      responsibleManagerId: defaultManagers[index]!,
      leadType: number === 12 ? "Partner" : customer,
      phoneCount: number === 8 ? 2 : 1,
      emailCount: number === 11 ? 0 : number === 9 ? 2 : 1,
    };
  },
);

export const EXPECTED_MESSAGE_COUNT = 60;
export const EXPECTED_AMBIGUOUS_MESSAGE_COUNT = 2;

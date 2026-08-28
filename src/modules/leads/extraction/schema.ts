import { z } from "zod";

const evidenceIdSchema = z
  .string()
  .regex(/^(?:msg:\d+:text|att:\d+:(?:transcript|ocr))$/u)
  .max(64);
const evidenceIdsSchema = z.array(evidenceIdSchema).max(32);

const candidateFieldSchema = z
  .object({
    value: z.string().trim().min(1).max(240).nullable(),
    evidence_ids: evidenceIdsSchema,
    status: z.enum(["supported", "conflicted", "uncertain"]),
  })
  .strict();

const listValueSchema = z
  .object({
    value: z.string().trim().min(1).max(240),
    evidence_ids: evidenceIdsSchema,
  })
  .strict();

export const PRODUCT_INTEREST_VALUES = [
  "Platform/Core",
  "Analytics",
  "Integration Services",
  "Support & SLA",
  "Training",
  "OEM/White label",
] as const;

export const rawGroupExtractionSchema = z
  .object({
    person: z
      .object({
        full_name: candidateFieldSchema,
        company: candidateFieldSchema,
        job_title: candidateFieldSchema,
      })
      .strict(),
    phones: z.array(listValueSchema).max(16),
    emails: z.array(listValueSchema).max(16),
    relationship_indicators: z.array(listValueSchema).max(16),
    product_interests: z
      .array(
        z
          .object({
            value: z.string().trim().min(1).max(80),
            evidence_ids: evidenceIdsSchema,
          })
          .strict(),
      )
      .max(16),
    region: z
      .object({
        value: z.string().trim().min(1).max(80).nullable(),
        evidence_ids: evidenceIdsSchema,
        status: z.enum(["supported", "uncertain"]),
      })
      .strict(),
    priority: z
      .object({
        value: z.string().trim().min(1).max(80).nullable(),
        evidence_ids: evidenceIdsSchema,
        status: z.enum(["supported", "uncertain"]),
      })
      .strict(),
    facts: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(280),
            evidence_ids: evidenceIdsSchema,
          })
          .strict(),
      )
      .max(24),
  })
  .strict();

export const structuredGroupExtractionSchema = rawGroupExtractionSchema
  .extend({
    product_interests: z
      .array(
        z
          .object({
            value: z.enum(PRODUCT_INTEREST_VALUES),
            evidence_ids: evidenceIdsSchema,
          })
          .strict(),
      )
      .max(16),
    region: z
      .object({
        value: z.literal("Europe").nullable(),
        evidence_ids: evidenceIdsSchema,
        status: z.enum(["supported", "uncertain"]),
      })
      .strict(),
    priority: z
      .object({
        value: z.enum(["High", "Medium", "Low"]).nullable(),
        evidence_ids: evidenceIdsSchema,
        status: z.enum(["supported", "uncertain"]),
      })
      .strict(),
  })
  .strict();

export type RawGroupExtraction = z.infer<typeof rawGroupExtractionSchema>;

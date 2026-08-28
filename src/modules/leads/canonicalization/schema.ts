import { z } from "zod";

import { PRODUCT_INTEREST_VALUES } from "../extraction/schema";

const uuidList = z.array(z.string().uuid()).max(100);
const field = z
  .object({
    value: z.string().nullable(),
    status: z.enum(["supported", "conflicted", "uncertain"]),
    groupIds: uuidList,
  })
  .strict();
const contact = z
  .object({
    value: z.string().min(1).max(240),
    normalizedValue: z.string().min(1).max(320),
    groupIds: uuidList,
  })
  .strict();
const groupValue = z
  .object({ value: z.string().min(1).max(280), groupIds: uuidList })
  .strict();

export const canonicalLeadPayloadSchema = z
  .object({
    person: z
      .object({ fullName: field, company: field, jobTitle: field })
      .strict(),
    phones: z.array(contact).max(64),
    emails: z.array(contact).max(64),
    relationshipIndicators: z.array(groupValue).max(64),
    productInterests: z
      .array(
        z
          .object({
            value: z.enum(PRODUCT_INTEREST_VALUES),
            groupIds: uuidList,
          })
          .strict(),
      )
      .max(16),
    region: z
      .object({ value: z.literal("Europe").nullable(), groupIds: uuidList })
      .strict(),
    priority: z
      .object({
        value: z.enum(["High", "Medium", "Low"]).nullable(),
        groupIds: uuidList,
      })
      .strict(),
    facts: z
      .array(
        z
          .object({ text: z.string().min(1).max(280), groupIds: uuidList })
          .strict(),
      )
      .max(100),
    leadType: z
      .object({
        value: z.enum(["Partner", "Customer"]),
        status: z.enum(["supported", "conflicted", "defaulted"]),
        groupIds: uuidList,
      })
      .strict(),
    campaign: z
      .object({
        exhibition: z.literal("Hannover Messe 2026"),
        exhibitionBitrixId: z.literal(63),
        source: z.literal("EXHIBITION"),
      })
      .strict(),
  })
  .strict();

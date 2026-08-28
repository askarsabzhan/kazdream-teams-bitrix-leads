import "server-only";

import type { BitrixClient } from "./client";
import { BitrixSyncError } from "./errors";
import type { BitrixLeadFields, BitrixLeadGateway } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BitrixSyncError("BITRIX_INVALID_ID_RESPONSE", "retryable_failed");
  }
  return id;
}

function containsExactSource(value: unknown, sourceGroupId: string): boolean {
  if (typeof value === "string") return value === sourceGroupId;
  if (Array.isArray(value)) return value.some((item) => String(item) === sourceGroupId);
  return false;
}

export class BitrixLeads implements BitrixLeadGateway {
  constructor(
    private readonly client: BitrixClient,
    private readonly sourceGroupField = "UF_CRM_TEAMS_GROUP_ID",
  ) {}

  async lookupBySourceGroup(sourceGroupId: string): Promise<number[]> {
    const matches = new Set<number>();
    let start = 0;
    for (let page = 0; page < 5; page += 1) {
      const response = await this.client.call("crm.lead.list", {
        order: { ID: "ASC" },
        filter: { [this.sourceGroupField]: sourceGroupId },
        select: ["ID", this.sourceGroupField],
        start,
      });
      if (!Array.isArray(response.result)) {
        throw new BitrixSyncError("BITRIX_INVALID_LEAD_LIST", "retryable_failed");
      }
      for (const value of response.result) {
        if (!isRecord(value) || !containsExactSource(value[this.sourceGroupField], sourceGroupId)) {
          continue;
        }
        matches.add(positiveId(value.ID));
      }
      if (matches.size > 1 || response.next === undefined) break;
      start = response.next;
    }
    return [...matches].sort((left, right) => left - right);
  }

  async add(fields: BitrixLeadFields): Promise<number> {
    const response = await this.client.call("crm.lead.add", { fields });
    return positiveId(response.result);
  }

  async update(bitrixLeadId: number, fields: BitrixLeadFields): Promise<void> {
    const response = await this.client.call("crm.lead.update", {
      id: bitrixLeadId,
      fields,
    });
    if (response.result !== true && response.result !== 1) {
      throw new BitrixSyncError("BITRIX_UPDATE_REJECTED", "retryable_failed");
    }
  }

  async get(bitrixLeadId: number): Promise<Record<string, unknown>> {
    const response = await this.client.call("crm.lead.get", { id: bitrixLeadId });
    if (!isRecord(response.result)) {
      throw new BitrixSyncError("BITRIX_INVALID_LEAD_RESPONSE", "retryable_failed");
    }
    return response.result;
  }

  async addSourceComment(bitrixLeadId: number, comment: string): Promise<number> {
    const response = await this.client.call("crm.timeline.comment.add", {
      fields: {
        ENTITY_ID: bitrixLeadId,
        ENTITY_TYPE: "lead",
        COMMENT: comment,
      },
    });
    return positiveId(response.result);
  }
}

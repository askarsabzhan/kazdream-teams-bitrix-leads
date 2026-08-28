import "server-only";

import type { BitrixClient } from "./client";
import { BitrixSyncError } from "./errors";
import type { BitrixUserGateway } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class BitrixUsers implements BitrixUserGateway {
  constructor(private readonly client: BitrixClient) {}

  async findExactByEmail(email: string): Promise<number[]> {
    const normalizedEmail = email.trim().toLocaleLowerCase("und");
    const matches = new Set<number>();
    let start = 0;
    for (let page = 0; page < 5; page += 1) {
      const response = await this.client.call("user.get", {
        FILTER: { EMAIL: normalizedEmail },
        start,
      });
      if (!Array.isArray(response.result)) {
        throw new BitrixSyncError("BITRIX_INVALID_USER_LIST", "retryable_failed");
      }
      for (const value of response.result) {
        if (!isRecord(value) || typeof value.EMAIL !== "string") continue;
        if (value.EMAIL.trim().toLocaleLowerCase("und") !== normalizedEmail) continue;
        const id = Number(value.ID);
        if (Number.isSafeInteger(id) && id > 0) matches.add(id);
      }
      if (response.next === undefined) break;
      start = response.next;
    }
    return [...matches].sort((left, right) => left - right);
  }
}

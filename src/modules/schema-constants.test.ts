import { describe, expect, it } from "vitest";
import { APP_ROLES } from "./auth/constants";
import { CRM_OUTBOX_STATES, CRM_STATES } from "./bitrix/constants";
import {
  DUPLICATE_OWNER_POLICIES,
  LATE_UPDATE_POLICIES,
  LEAD_TYPES,
  LEAD_WITHOUT_CONTACTS_POLICIES,
} from "./leads/constants";
import { MESSAGE_STATES } from "./teams/constants";
import { JOB_STATES } from "./workflow/constants";

describe("schema-related domain constants", () => {
  it("keeps application roles and lead types aligned with database checks", () => {
    expect(APP_ROLES).toEqual(["user", "admin"]);
    expect(LEAD_TYPES).toEqual(["partner", "customer"]);
  });

  it("keeps confirmed campaign policies aligned with database defaults", () => {
    expect(DUPLICATE_OWNER_POLICIES).toEqual(["latest_contributor"]);
    expect(LEAD_WITHOUT_CONTACTS_POLICIES).toEqual([
      "require_name_and_phone",
    ]);
    expect(LATE_UPDATE_POLICIES).toEqual(["update_crm"]);
  });

  it("keeps message states aligned with the durable message workflow", () => {
    expect(MESSAGE_STATES).toEqual([
      "received",
      "waiting_attachment",
      "ready",
      "processing",
      "processed",
      "ignored",
      "retryable_failed",
      "permanent_failed",
    ]);
  });

  it("keeps job and CRM states aligned with durable queue constraints", () => {
    expect(JOB_STATES).toEqual([
      "pending",
      "processing",
      "succeeded",
      "retryable_failed",
      "permanent_failed",
    ]);
    expect(CRM_STATES).toEqual(JOB_STATES);
    expect(CRM_OUTBOX_STATES).toEqual([
      "pending",
      "processing",
      "succeeded",
      "retryable_failed",
      "reconciling",
      "permanent_failed",
    ]);
  });
});

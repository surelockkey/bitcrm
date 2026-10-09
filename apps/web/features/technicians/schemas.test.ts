import { describe, it, expect } from "vitest";
import { commissionSchema, sensitiveSchema, profileSchema } from "./schemas";

describe("commissionSchema", () => {
  it("accepts a base rate in 0–100", () => {
    expect(commissionSchema.safeParse({ baseRatePct: 40 }).success).toBe(true);
  });
  it("rejects a rate above 100", () => {
    expect(commissionSchema.safeParse({ baseRatePct: 120 }).success).toBe(false);
  });
  it("coerces string percentages from inputs", () => {
    const r = commissionSchema.safeParse({ baseRatePct: "40", creditCardFeePct: "3" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.baseRatePct).toBe(40);
  });
});

describe("sensitiveSchema", () => {
  it("accepts a valid SSN and bank account", () => {
    expect(sensitiveSchema.safeParse({ ssn: "123-45-6789", bankAccount: "000123456789" }).success).toBe(true);
  });
  it("rejects a malformed SSN", () => {
    expect(sensitiveSchema.safeParse({ ssn: "12-3456" }).success).toBe(false);
  });
  it("rejects a too-short bank account", () => {
    expect(sensitiveSchema.safeParse({ bankAccount: "12" }).success).toBe(false);
  });
});

describe("profileSchema", () => {
  // Everything the card always carries: the operational booleans and status,
  // and — since 2026-09-17 — the user record's half (name, field team), the
  // user type and the list of additional numbers. Each has a default from the
  // record, so a save never has to invent one.
  const base = {
    firstName: "Riley",
    lastName: "Santos",
    fieldTeamMember: true,
    technicianType: "regular",
    additionalPhones: [],
    callMaskingEnabled: false,
    gpsTrackingEnabled: false,
    mobileAppInstalled: false,
    status: "active",
  };

  it("accepts the card's own fields with nothing optional filled in", () => {
    expect(profileSchema.safeParse(base).success).toBe(true);
  });

  it("knows two user types and no third", () => {
    expect(profileSchema.safeParse({ ...base, technicianType: "subcontractor" }).success).toBe(true);
    expect(profileSchema.safeParse({ ...base, technicianType: "owner" }).success).toBe(false);
  });

  it("caps the additional numbers where the API does", () => {
    expect(profileSchema.safeParse({ ...base, additionalPhones: ["1", "2", "3", "4", "5"] }).success).toBe(true);
    expect(profileSchema.safeParse({ ...base, additionalPhones: ["1", "2", "3", "4", "5", "6"] }).success).toBe(false);
  });

  // The Availability tab's hours now save with the card, as on Workiz's page
  // (one Save at the foot of every tab).
  it("carries the work hours, and refuses an end before the start", () => {
    const hours = { workingDays: [1, 2, 3, 4, 5], workStart: "08:00", workEnd: "17:00" };
    expect(profileSchema.safeParse({ ...base, ...hours }).success).toBe(true);
    const bad = profileSchema.safeParse({ ...base, ...hours, workStart: "18:00" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].path).toEqual(["workEnd"]);
    expect(profileSchema.safeParse({ ...base, ...hours, workingDays: [7] }).success).toBe(false);
  });
});

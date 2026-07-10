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
  it("requires the operational booleans + status", () => {
    const r = profileSchema.safeParse({
      callMaskingEnabled: false,
      gpsTrackingEnabled: false,
      mobileAppInstalled: false,
      status: "active",
    });
    expect(r.success).toBe(true);
  });
});

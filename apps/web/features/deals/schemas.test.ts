import { describe, expect, it } from "vitest";
import { addressSchema, dealJobSchema } from "./schemas";

describe("dealJobSchema — Workiz's Job name", () => {
  const base = {
    clientType: "residential",
    jobTypeId: "jt",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    priority: "normal",
  };
  it("carries it, trimmed, and refuses more than 200 characters", () => {
    expect(dealJobSchema.parse({ ...base, jobName: "  Gate repair " }).jobName).toBe("Gate repair");
    expect(dealJobSchema.safeParse({ ...base, jobName: "x".repeat(201) }).success).toBe(false);
  });
});

describe("addressSchema", () => {
  const base = { street: "Princeton", city: "Princeton", state: "TX", zip: "75407" };

  it("keeps the Workiz Country (ISO code) the form picked", () => {
    expect(addressSchema.parse({ ...base, country: "CA" }).country).toBe("CA");
  });

  it("leaves it out when none was picked (absent = United States)", () => {
    expect(addressSchema.parse(base)).not.toHaveProperty("country");
  });
});

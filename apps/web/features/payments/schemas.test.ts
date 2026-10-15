import { describe, expect, it } from "vitest";
import { DEFAULT_PAYMENT_SETTINGS, MAX_SURCHARGE_PERCENT } from "@bitcrm/types";
import {
  paymentSettingsSchema,
  recordPaymentSchema,
  toRecordPaymentBody,
  settingsToForm,
  toSettingsBody,
} from "./schemas";

describe("recordPaymentSchema — Workiz's Add payment", () => {
  const valid = {
    amount: "125.50",
    type: "check",
    reference: "1042",
    note: "",
    takenAt: "2026-09-20",
    chargedByReferral: false,
  };

  it("keeps the typed amount for the form and trims the rest", () => {
    const parsed = recordPaymentSchema.parse({ ...valid, reference: " 1042 " });
    expect(parsed.amount).toBe("125.50");
    expect(parsed.type).toBe("check");
    expect(parsed.reference).toBe("1042");
  });

  it("takes every Workiz type, Credit charge included", () => {
    for (const type of ["charge", "cash", "credit", "bank_transfer_offline", "zelle", "debit_offline"]) {
      expect(recordPaymentSchema.safeParse({ ...valid, type }).success).toBe(true);
    }
  });

  it("refuses nothing, zero and a negative amount", () => {
    for (const amount of ["", "0", "-4"]) {
      expect(recordPaymentSchema.safeParse({ ...valid, amount }).success).toBe(false);
    }
  });

  it("refuses a type that is not one of Add payment's — ACH stays the portal's", () => {
    expect(recordPaymentSchema.safeParse({ ...valid, type: "bank_transfer" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...valid, type: "bank" }).success).toBe(false);
  });

  it("refuses a date it cannot read", () => {
    expect(recordPaymentSchema.safeParse({ ...valid, takenAt: "20/09/2026" }).success).toBe(false);
  });
});

describe("toRecordPaymentBody", () => {
  it("sends the Workiz type with the method it maps to, and the referral flag only when ticked", () => {
    expect(
      toRecordPaymentBody(
        { amount: "40", type: "zelle", reference: "ZL-1", note: "", takenAt: "2026-09-20", chargedByReferral: true },
        "2026-09-20T16:00:00.000Z",
      ),
    ).toEqual({
      amount: 40,
      method: "other",
      methodDetail: "zelle",
      reference: "ZL-1",
      takenAt: "2026-09-20T16:00:00.000Z",
      chargedByReferral: true,
    });
    expect(
      toRecordPaymentBody(
        { amount: "10", type: "bank_transfer_offline", reference: "", note: "n", takenAt: "2026-09-20", chargedByReferral: false },
        "2026-09-20T16:00:00.000Z",
      ),
    ).toEqual({ amount: 10, method: "bank", methodDetail: "bank_transfer_offline", note: "n", takenAt: "2026-09-20T16:00:00.000Z" });
  });
});

describe("payment settings form", () => {
  it("round-trips the account defaults", () => {
    const form = settingsToForm(DEFAULT_PAYMENT_SETTINGS);
    expect(form.surchargePercent).toBe("0");
    expect(form.bankMinimum).toBe("20");
    expect(form.tipPresets).toBe("10, 15, 20");
    const parsed = paymentSettingsSchema.parse(form);
    expect(toSettingsBody(parsed)).toMatchObject({
      onlinePaymentsEnabled: false,
      cardEnabled: true,
      bankEnabled: false,
      bankMinimum: 20,
      allowPartial: true,
      surchargePercent: 0,
      tipsEnabled: false,
      tipPresets: [10, 15, 20],
    });
  });

  it("falls back to the account defaults when settings haven't loaded", () => {
    expect(settingsToForm(undefined)).toEqual(settingsToForm(DEFAULT_PAYMENT_SETTINGS));
  });

  it("caps the surcharge at the card-network ceiling", () => {
    const form = settingsToForm(DEFAULT_PAYMENT_SETTINGS);
    expect(paymentSettingsSchema.safeParse({ ...form, surchargePercent: "3" }).success).toBe(true);
    const over = paymentSettingsSchema.safeParse({ ...form, surchargePercent: "3.5" });
    expect(over.success).toBe(false);
    expect(over.success === false && over.error.issues[0].message).toContain(`${MAX_SURCHARGE_PERCENT}%`);
  });

  it("refuses a negative bank minimum", () => {
    const form = settingsToForm(DEFAULT_PAYMENT_SETTINGS);
    expect(paymentSettingsSchema.safeParse({ ...form, bankMinimum: "-1" }).success).toBe(false);
  });

  it("refuses online payments with neither card nor bank turned on", () => {
    const form = settingsToForm(DEFAULT_PAYMENT_SETTINGS);
    const bad = paymentSettingsSchema.safeParse({
      ...form,
      onlinePaymentsEnabled: true,
      cardEnabled: false,
      bankEnabled: false,
    });
    expect(bad.success).toBe(false);
  });

  it("reads tip presets as a list of numbers and drops the junk", () => {
    const form = { ...settingsToForm(DEFAULT_PAYMENT_SETTINGS), tipPresets: "10, 15 ,, 20, x" };
    const parsed = paymentSettingsSchema.parse(form);
    expect(toSettingsBody(parsed).tipPresets).toEqual([10, 15, 20]);
  });
});

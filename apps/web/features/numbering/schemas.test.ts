import { describe, expect, it } from "vitest";
import { fieldOfRefusal, numberingFormSchema, numberingToForm, toNumberingBody } from "./schemas";

/**
 * Settings → Numbering's boxes hold whole numbers: what the next client
 * invoice / estimate is called. The server is the one that knows the last
 * number handed out; the page only keeps nonsense from reaching it and puts
 * the server's refusal under the box it names.
 */
describe("numberingFormSchema", () => {
  it("takes whole numbers from 1 up to nine digits", () => {
    expect(numberingFormSchema.safeParse({ nextInvoiceNumber: "85427", nextEstimateNumber: "1142" }).success).toBe(true);
    expect(numberingFormSchema.safeParse({ nextInvoiceNumber: "1", nextEstimateNumber: "999999999" }).success).toBe(true);
  });

  it("refuses an empty box, letters, decimals, zero and a tenth digit — naming the box", () => {
    for (const bad of ["", "abc", "12.5", "0", "1000000000", "-5", "85 427"]) {
      const r = numberingFormSchema.safeParse({ nextInvoiceNumber: bad, nextEstimateNumber: "1142" });
      expect(r.success, bad).toBe(false);
      if (!r.success) expect(r.error.issues[0].path).toEqual(["nextInvoiceNumber"]);
    }
  });

  it("turns the settings into box text and back into whole numbers", () => {
    expect(numberingToForm({ nextInvoiceNumber: 85427, nextEstimateNumber: 1142 })).toEqual({
      nextInvoiceNumber: "85427",
      nextEstimateNumber: "1142",
    });
    expect(numberingToForm(undefined)).toEqual({ nextInvoiceNumber: "", nextEstimateNumber: "" });
    expect(toNumberingBody({ nextInvoiceNumber: "85427", nextEstimateNumber: "1142" })).toEqual({
      nextInvoiceNumber: 85427,
      nextEstimateNumber: 1142,
    });
  });
});

describe("fieldOfRefusal", () => {
  it("knows which box the server's words are about", () => {
    expect(fieldOfRefusal("Next Invoice Id must be more than the last number (85426)")).toBe("nextInvoiceNumber");
    expect(fieldOfRefusal("Next Estimate Id must be more than the last number (1141) — a document took a number just now")).toBe(
      "nextEstimateNumber",
    );
    expect(fieldOfRefusal("Nothing to set")).toBeNull();
  });
});

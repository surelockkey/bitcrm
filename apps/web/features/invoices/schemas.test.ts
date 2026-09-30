import { describe, expect, it } from "vitest";
import { PaymentTerms } from "@bitcrm/types";
import { invoiceEditSchema } from "./schemas";

const valid = {
  invoiceDate: "2026-09-16",
  paymentTerms: PaymentTerms.NET_15,
  dueDate: "2026-10-01",
  notes: "",
};

describe("invoiceEditSchema", () => {
  it("accepts a valid header", () => {
    expect(invoiceEditSchema.safeParse(valid).success).toBe(true);
  });

  it("requires real calendar days", () => {
    const r = invoiceEditSchema.safeParse({ ...valid, invoiceDate: "2026-02-31" });
    expect(r.success).toBe(false);
  });

  it("rejects a due date before the invoice date", () => {
    const r = invoiceEditSchema.safeParse({ ...valid, dueDate: "2026-09-01" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["dueDate"]);
  });

  it("rejects unknown terms and overly long notes", () => {
    expect(invoiceEditSchema.safeParse({ ...valid, paymentTerms: "net90" }).success).toBe(false);
    expect(invoiceEditSchema.safeParse({ ...valid, notes: "x".repeat(5001) }).success).toBe(false);
  });

  it("trims notes", () => {
    const r = invoiceEditSchema.parse({ ...valid, notes: "  hi  " });
    expect(r.notes).toBe("hi");
  });
});

import { describe, expect, it } from "vitest";
import { PaymentTerms, type BusinessProfile } from "@bitcrm/types";
import {
  companyFormSchema,
  companyToForm,
  formToCompanyBody,
  type CompanyFormValues,
} from "./schemas";

const base: CompanyFormValues = companyToForm(undefined);

const full: BusinessProfile = {
  id: "bp-2",
  isDefault: false,
  active: true,
  name: "SureLock",
  email: "a@b.co",
  address: { street: "1 Main", city: "Hartford", state: "CT", zip: "06103", lat: 1, lng: 2 },
  logoAssetId: "asset1",
  defaultPaymentTerms: PaymentTerms.CUSTOM,
  defaultCustomTermDays: 20,
  dueDateBasis: "job_scheduled",
  updatedAt: "x",
};

describe("companyFormSchema", () => {
  it("starts blank for a new company (active, due on receipt)", () => {
    expect(base.name).toBe("");
    expect(base.active).toBe(true);
    expect(base.logoAssetId).toBe("");
    expect(base.defaultPaymentTerms).toBe(PaymentTerms.CASH);
    expect(base.dueDateBasis).toBe("invoice_created");
  });

  it("requires a name and validates the email", () => {
    const r = companyFormSchema.safeParse({ ...base, name: "", email: "nope" });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["name", "email"]));
  });

  it("requires days for custom terms", () => {
    const r = companyFormSchema.safeParse({ ...base, name: "X", defaultPaymentTerms: PaymentTerms.CUSTOM, defaultCustomTermDays: "" });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join("."))).toContain("defaultCustomTermDays");
    expect(
      companyFormSchema.safeParse({ ...base, name: "X", defaultPaymentTerms: PaymentTerms.CUSTOM, defaultCustomTermDays: "45" }).success,
    ).toBe(true);
  });

  it("requires the rest of a partly filled address", () => {
    const r = companyFormSchema.safeParse({ ...base, name: "X", address: { ...base.address, street: "1 Main" } });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["address.city", "address.state", "address.zip"]),
    );
  });
});

describe("company <-> form", () => {
  it("round-trips a create body and drops blanks", () => {
    const parsed = companyFormSchema.parse(companyToForm(full));
    expect(formToCompanyBody(parsed, "create")).toEqual({
      name: "SureLock",
      active: true,
      email: "a@b.co",
      address: { street: "1 Main", city: "Hartford", state: "CT", zip: "06103", lat: 1, lng: 2 },
      logoAssetId: "asset1",
      defaultPaymentTerms: PaymentTerms.CUSTOM,
      defaultCustomTermDays: 20,
      dueDateBasis: "job_scheduled",
    });
  });

  it("create omits the address, custom days and logo when blank", () => {
    const parsed = companyFormSchema.parse({ ...base, name: "New", defaultCustomTermDays: "30" });
    const out = formToCompanyBody(parsed, "create");
    expect(out).not.toHaveProperty("address");
    expect(out).not.toHaveProperty("defaultCustomTermDays");
    expect(out).not.toHaveProperty("logoAssetId");
    expect(out).not.toHaveProperty("legalName");
  });

  it("update sends null for cleared fields — a removed logo is logoAssetId: null", () => {
    const form = companyToForm(full);
    const parsed = companyFormSchema.parse({
      ...form,
      email: "",
      logoAssetId: "",
      address: { street: "", unit: "", city: "", state: "", zip: "" },
      defaultPaymentTerms: PaymentTerms.NET_30,
    });
    const out = formToCompanyBody(parsed, "update");
    expect(out).toMatchObject({
      name: "SureLock",
      email: null,
      legalName: null,
      phone: null,
      website: null,
      licenseNumber: null,
      logoAssetId: null,
      address: null,
      defaultPaymentTerms: PaymentTerms.NET_30,
      defaultCustomTermDays: null,
    });
  });

  it("update carries the archived flag", () => {
    const parsed = companyFormSchema.parse({ ...companyToForm(full), active: false });
    expect(formToCompanyBody(parsed, "update")).toMatchObject({ active: false });
  });
});

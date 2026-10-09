import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { ClientType, CompanyDocumentType, CrmStatus, PaymentTerms, type Company } from "@bitcrm/types";
import { installFakeServer, renderWithClient } from "@/test/page-load";

/**
 * The company's Compliance tab (ours; Workiz keeps a client's terms in Edit
 * client info): the terms as Workiz's caption-over-value pairs, the COI's
 * state in words, and the W-9 / COI as Workiz's bordered cards — View, and
 * Upload file / Delete for someone who may edit the company.
 */

const grants = new Set<string>();
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string, a = "view") => grants.has(`${r}.${a}`), isLoading: false }),
}));

const company: Company = {
  id: "co1",
  title: "Acme Storage",
  phones: [],
  emails: [],
  clientType: ClientType.COMMERCIAL,
  status: CrmStatus.ACTIVE,
  paymentTerms: PaymentTerms.NET_30,
  taxExempt: true,
  poRequired: false,
  coiExpiration: "2020-01-31",
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const { CompanyComplianceTab } = await import("./company-compliance-tab");

beforeEach(() => {
  grants.clear();
  grants.add("companies.view");
  installFakeServer([
    { match: /\/crm\/companies\/co1\/documents$/, reply: () => [{ docType: CompanyDocumentType.W9, contentType: "application/pdf", uploadedAt: "2026-09-01T15:00:00.000Z" }] },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CompanyComplianceTab", () => {
  it("lists the terms: payment terms, tax exempt, PO required, the COI's date and state", async () => {
    renderWithClient(<CompanyComplianceTab company={company} />);
    const terms = await screen.findByRole("list", { name: "Payment" });
    expect(within(terms).getByText("Payment terms").nextElementSibling).toHaveTextContent("Net-30");
    expect(within(terms).getByText("Tax exempt").nextElementSibling).toHaveTextContent("Yes");
    expect(within(terms).getByText("PO required").nextElementSibling).toHaveTextContent("No");
    expect(within(terms).getByText("COI expiration").nextElementSibling).toHaveTextContent("Fri Jan 31, 2020 · Expired");
  });

  it("shows an uploaded document with View, a missing one as not uploaded — read-only without companies.edit", async () => {
    renderWithClient(<CompanyComplianceTab company={company} />);
    const w9 = await screen.findByRole("group", { name: "W-9" });
    expect(await within(w9).findByRole("button", { name: "View" })).toBeInTheDocument();
    expect(within(w9).queryByRole("button", { name: "Delete W-9" })).toBeNull();
    const coi = screen.getByRole("group", { name: "COI (insurance)" });
    expect(within(coi).getByText("Not uploaded")).toBeInTheDocument();
    expect(within(coi).queryByRole("button", { name: /upload/i })).toBeNull();
  });

  it("lets someone who may edit the company upload the missing one and delete the uploaded one", async () => {
    grants.add("companies.edit");
    renderWithClient(<CompanyComplianceTab company={company} />);
    const w9 = await screen.findByRole("group", { name: "W-9" });
    expect(await within(w9).findByRole("button", { name: "Delete W-9" })).toBeInTheDocument();
    const coi = screen.getByRole("group", { name: "COI (insurance)" });
    expect(within(coi).getByRole("button", { name: "Upload file" })).toBeInTheDocument();
  });
});

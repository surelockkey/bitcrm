import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Contact } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({ value }: { value: string }) => <input aria-label="Street" defaultValue={value} />,
}));

import { ContactForm } from "./contact-form";

const addr = (street: string) => ({ street, city: "Dallas", state: "TX", zip: "75201" });
const CONTACT = {
  id: "c1",
  firstName: "CBRE",
  lastName: "Facilities Management",
  phones: ["+18557836342"],
  phoneExtensions: {},
  emails: [],
  addresses: [addr("241 E FM 1382"), addr("300 Convent St"), addr("18840 I-35")],
  type: "company_representative",
  source: "manual",
  sourceId: "src-tx-platinum",
  paymentTerms: "custom",
  customTermsDays: 60,
  taxExempt: true,
  taxExemptReason: "Resale",
  status: "active",
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
} as unknown as Contact;

const JOB_SOURCES = [
  { id: "src-tx-platinum", name: "SURE TX PLATINUM", priority: 989, active: true },
  { id: "src-ct-google", name: "SURE CT GOOGLE ADS", priority: 10, active: true },
];

describe("ContactForm layouts", () => {
  it("the popup's Ad source is the job-source catalog with the client's one chosen, and the terms read Custom + 60 days", async () => {
    server.use(
      http.get("*/crm/companies", () => HttpResponse.json({ success: true, data: [], pagination: {} })),
      http.get("*/deals/job-sources", () => HttpResponse.json({ success: true, data: JOB_SOURCES })),
    );
    renderWithClient(<ContactForm contact={CONTACT} layout="dialog" />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Ad source" })).toHaveTextContent("SURE TX PLATINUM"));
    expect(screen.getByRole("combobox", { name: "Client payment terms" })).toHaveTextContent("Custom");
    expect(screen.getByRole("spinbutton", { name: "Days" })).toHaveValue(60);
    expect(screen.getByRole("combobox", { name: "Tax exempt reason" })).toHaveTextContent("Resale");
  });

  it("the Tax exempt reason list is Workiz's", async () => {
    const { TAX_EXEMPT_REASONS } = await import("@/features/billing/lib");
    expect([...TAX_EXEMPT_REASONS]).toEqual([
      "Federal government", "State government", "Local government", "Tribal government", "Charitable organization",
      "Religious organization", "Educational organization", "Hospital", "Direct pay permit", "Multiple points of use",
      "Direct mail", "Agricultural production", "Industrial production / manufacturing", "Foreign diplomat", "Resale", "Other",
    ]);
  });

  it("the Edit client info popup carries no address list — Workiz keeps addresses on the card, not in the popup", async () => {
    server.use(http.get("*/crm/companies", () => HttpResponse.json({ success: true, data: [], pagination: {} })));
    renderWithClient(<ContactForm contact={CONTACT} layout="dialog" />);
    expect(await screen.findByText("Client details")).toBeInTheDocument();
    for (const label of ["First Name", "Last Name", "Company name", "Contact information", "Phone number", "Secondary phone", "Email", "Description", "Payment", "Tax exempt", "Additional", "Ad source"]) {
      expect(screen.getByText(label, { selector: "label, h3" })).toBeInTheDocument();
    }
    expect(screen.getAllByText("ext.")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByText("Addresses")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove address/ })).toBeNull();
    expect(screen.queryByLabelText("Street")).toBeNull();
  });

  it("the full form still lists the addresses", async () => {
    server.use(http.get("*/crm/companies", () => HttpResponse.json({ success: true, data: [], pagination: {} })));
    renderWithClient(<ContactForm contact={CONTACT} />);
    expect(await screen.findByText("Addresses")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Remove address/ })).toHaveLength(3);
  });
});

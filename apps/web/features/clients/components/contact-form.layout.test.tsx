import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
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
  status: "active",
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
} as unknown as Contact;

describe("ContactForm layouts", () => {
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

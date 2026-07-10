import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientType, ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Company, Contact } from "@bitcrm/types";
import { ContactsTable } from "./contacts-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    firstName: "Jane",
    lastName: "Smith",
    phones: ["+14045551234", "+14045559002"],
    emails: ["jane@acme.com"],
    companyId: "co1",
    type: ContactType.COMPANY_REPRESENTATIVE,
    title: "Facilities Manager",
    source: ContactSource.PHONE_CALL,
    status: CrmStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const company: Company = {
  id: "co1",
  title: "Acme Storage",
  phones: [],
  emails: [],
  clientType: ClientType.COMMERCIAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};
const map = new Map([[company.id, company]]);

describe("ContactsTable", () => {
  it("renders name, resolves the company, and formats the primary phone with a +N chip", () => {
    render(<ContactsTable contacts={[contact()]} companyMap={map} />);
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("Acme Storage")).toBeInTheDocument();
    expect(screen.getByText("(404) 555-1234")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument(); // second phone hidden behind a chip
    expect(screen.getByText("Company rep")).toBeInTheDocument();
  });

  it("shows a dash for a residential contact with no company", () => {
    render(
      <ContactsTable
        contacts={[contact({ id: "c2", companyId: undefined, type: ContactType.RESIDENTIAL })]}
        companyMap={map}
      />,
    );
    expect(screen.getByText("Residential")).toBeInTheDocument();
  });

  it("navigates to the contact on row click", async () => {
    render(<ContactsTable contacts={[contact()]} companyMap={map} />);
    await userEvent.click(screen.getByText("Jane Smith"));
    expect(push).toHaveBeenCalledWith("/contacts/c1");
  });
});

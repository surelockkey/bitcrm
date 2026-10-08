import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientType, ContactSource, ContactType, CrmStatus, type ClientTag, type Company, type Contact } from "@bitcrm/types";
import { ClientsGrid } from "./clients-grid";

vi.mock("@/features/job-sources/lib", () => ({ useJobSourceName: () => (id?: string) => (id ? `Source ${id}` : "—") }));

const contact = (over: Partial<Contact> = {}): Contact => ({
  id: "c1",
  firstName: "Deena",
  lastName: "Galange",
  phones: ["+16024783345"],
  emails: [],
  addresses: [{ street: "261 E 10th St", city: "Mesa", state: "AZ", zip: "85203" }],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.MANUAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "2026-10-08T20:26:00.000Z",
  updatedAt: "",
  ...over,
});

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
const tag: ClientTag = {
  id: "t1",
  name: "Platinum",
  color: "blue",
  priority: 1,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const WORKIZ = ["name", "address", "phone", "created"] as const;

function setup(contacts: Contact[], columns: readonly string[] = WORKIZ) {
  const onOpen = vi.fn();
  render(
    <ClientsGrid
      contacts={contacts}
      columns={columns as never}
      companyMap={new Map([[company.id, company]])}
      tagMap={new Map([[tag.id, tag]])}
      onOpen={onOpen}
    />,
  );
  return { onOpen };
}

const dataRows = () => screen.getAllByRole("row").filter((r) => r.closest("tbody") && !r.hasAttribute("aria-hidden"));

describe("ClientsGrid — Workiz's Clients grid", () => {
  it("heads the columns Name | Address | Phone | Created", () => {
    setup([contact()]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Address", "Phone", "Created"]);
  });

  it("prints a row the way Workiz does", () => {
    setup([contact()]);
    const [row] = dataRows();
    const cells = within(row).getAllByRole("cell");
    expect(within(cells[0]).getByText("Deena Galange")).toBeInTheDocument();
    // No email: the number under the name, as a blue tel link.
    expect(within(cells[0]).getByRole("link", { name: "(602) 478-3345" })).toHaveAttribute("href", "tel:+16024783345");
    expect(cells[1]).toHaveTextContent("261 E 10th St Mesa, AZ 85203");
    expect(within(cells[2]).getByRole("link", { name: "(602) 478-3345" })).toBeInTheDocument();
    expect(cells[3]).toHaveTextContent("Thu Oct 08, 2026 04:26 PM");
  });

  it("puts the email under the name when there is one, and the client's tags under that", () => {
    setup([contact({ emails: ["bspag@qu.edu"], tagIds: ["t1", "gone"] })]);
    const [row] = dataRows();
    const name = within(row).getAllByRole("cell")[0];
    expect(within(name).getByText("bspag@qu.edu")).toBeInTheDocument();
    expect(within(name).queryByRole("link")).toBeNull();
    const chip = within(name).getByText("Platinum");
    expect(chip.className).toContain("uppercase");
    // An archived or unknown tag id is not drawn as a blank chip.
    expect(within(name).queryByText("gone")).toBeNull();
  });

  it("says 'No phone number' in the Phone column when there is none", () => {
    setup([contact({ phones: [] })]);
    expect(screen.getByText("No phone number")).toBeInTheDocument();
  });

  it("opens the client on a row click, but not from its phone link", async () => {
    const { onOpen } = setup([contact()]);
    await userEvent.click(screen.getByText("Deena Galange"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe("c1");
    await userEvent.click(within(dataRows()[0]).getAllByRole("link")[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("never runs shorter than ten rows (react-table minRows)", () => {
    setup([contact()]);
    expect(dataRows()).toHaveLength(1);
    expect(screen.getAllByRole("row", { hidden: true }).filter((r) => r.hasAttribute("aria-hidden"))).toHaveLength(9);
  });

  it("says 'No Records Found' over blank rows when empty", () => {
    setup([]);
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
    expect(screen.getAllByRole("row", { hidden: true }).filter((r) => r.hasAttribute("aria-hidden"))).toHaveLength(10);
  });

  it("draws the columns the Visible fields panel saved, in its order", () => {
    setup([contact({ companyId: "co1", emails: ["a@b.co"], sourceId: "s1" })], ["company", "name", "email", "source", "type"]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Company", "Name", "Email", "Ad Source", "Type"]);
    const cells = within(dataRows()[0]).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Acme Storage");
    expect(cells[2]).toHaveTextContent("a@b.co");
    expect(cells[3]).toHaveTextContent("Source s1");
    expect(cells[4]).toHaveTextContent("Residential");
  });
});

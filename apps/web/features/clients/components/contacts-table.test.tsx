import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";
import { ContactsTable } from "./contacts-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
// The Source column resolves a Workiz ad source through the catalog; the table test has no query client.
vi.mock("@/features/job-sources/lib", () => ({ useJobSourceName: () => (id?: string) => (id ? `Source ${id}` : "—") }));

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    firstName: "Jane",
    lastName: "Smith",
    phones: ["+14045551234", "+14045559002"],
    emails: ["jane@acme.com"],
    addresses: [],
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

const people = [
  contact(),
  contact({ id: "c2", firstName: "Bob", lastName: "Jones", title: undefined, phones: [], emails: [], type: ContactType.RESIDENTIAL, sourceId: "s9" }),
];

const titles = () =>
  within(screen.getByRole("table", { name: "Contacts" }))
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td div")?.textContent ?? "")
    .filter(Boolean);

beforeEach(() => push.mockClear());

describe("ContactsTable — the company's people as a Workiz grid", () => {
  it("prints the name with the person's job title under it, the number as a blue tel link, the email, type and ad source", () => {
    render(<ContactsTable contacts={people} />);
    const row = screen.getByText("Jane Smith").closest("tr")!;
    expect(within(row).getByText("Facilities Manager")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "(404) 555-1234" })).toHaveAttribute("href", "tel:+14045551234");
    expect(within(row).getByText("jane@acme.com")).toBeInTheDocument();
    expect(within(row).getByText("Company rep")).toBeInTheDocument();
    expect(within(row).getByText("Phone call")).toBeInTheDocument();
  });

  it("names a Workiz ad source from the catalog, and says a missing number is missing", () => {
    render(<ContactsTable contacts={people} />);
    const row = screen.getByText("Bob Jones").closest("tr")!;
    expect(within(row).getByText("Source s9")).toBeInTheDocument();
    expect(within(row).getByText("No phone number")).toBeInTheDocument();
    expect(within(row).getByText("Residential")).toBeInTheDocument();
  });

  it("lists the people A→Z, and the Name header turns the order round", async () => {
    render(<ContactsTable contacts={people} />);
    expect(titles()).toEqual(["Bob Jones", "Jane Smith"]);
    await userEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(titles()).toEqual(["Jane Smith", "Bob Jones"]);
  });

  it("the strip's Search narrows by name, title, email or number", async () => {
    render(<ContactsTable contacts={people} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search contacts" }), "facilities");
    expect(titles()).toEqual(["Jane Smith"]);
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search contacts" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search contacts" }), "5551234");
    expect(titles()).toEqual(["Jane Smith"]);
  });

  it("carries the caller's pieces in the strip after the Search", () => {
    render(<ContactsTable contacts={people} toolbar={<button type="button">Add contact</button>} />);
    expect(screen.getByRole("button", { name: "Add contact" })).toBeInTheDocument();
  });

  it("opens the person on a row click", async () => {
    render(<ContactsTable contacts={people} />);
    await userEvent.click(screen.getByText("Jane Smith"));
    expect(push).toHaveBeenCalledWith("/contacts/c1");
  });

  it("says No Records Found for a company without people, with Workiz's footer", () => {
    render(<ContactsTable contacts={[]} />);
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 to 0 of 0 results")).toBeInTheDocument();
  });
});

/**
 * Стабільний перший кадр.
 *
 * Ширини оголошені один раз і тягнуться мишею; жодна клітинка не міряється
 * по вмісту, інакше довга адреса чи пошта розсуває сусідів під курсором.
 */
describe("ContactsTable — a stable first frame", () => {
  const render1 = () => render(<ContactsTable contacts={[contact()]} />);

  it("lays the columns out at declared widths, not by content", () => {
    const { container } = render1();
    expect(container.querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const { container } = render1();
    const cols = [...container.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(container.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  it("lets no body cell set a width of its own", () => {
    const { container } = render1();
    for (const td of [...container.querySelectorAll("tbody td")]) {
      for (const cls of td.className.split(/\s+/)) {
        expect(cls).not.toMatch(/^(min-w-|max-w-|w-)/);
      }
      expect((td as HTMLElement).style.width).toBe("");
    }
  });

  it("puts a resize handle on every header", () => {
    render1();
    for (const id of ["name", "phone", "email", "type", "source"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});

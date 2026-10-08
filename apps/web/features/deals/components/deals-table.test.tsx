import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  JobSuperStatus,
  DealStatus,
} from "@bitcrm/types";
import type { Contact, Deal, User } from "@bitcrm/types";
import { DEFAULT_VISIBLE, JOB_FIELDS, type VisibleFields } from "../fields";
import { DealsTable, DealsTableSkeleton } from "./deals-table";

// Resolve job-type ids to names without a QueryClient/live catalog.
vi.mock("@/features/job-types/lib", () => ({
  useJobTypesLoading: () => false,
  useJobTypeName: () => (id: string | undefined) =>
    id === "jt-lockout" ? "Lockout" : (id ?? "—"),
}));

// JobTagChips reads the catalog via react-query; stub it so the row renders
// without a QueryClient (the test deal carries no tags anyway).
vi.mock("@/features/job-tags/components/job-tag-chips", () => ({
  JobTagChips: () => null,
}));

// Catalog resolvers the dynamic columns lean on; pinned so no QueryClient is needed.
vi.mock("@/features/external-companies/lib", () => ({
  useExternalCompanyName: () => (id: string | undefined) =>
    id === "ec-1" ? "Allied Dispatch Solutions" : "—",
}));
vi.mock("@/features/job-sources/lib", () => ({
  useJobSourceName: () => (id: string | undefined) => (id === "src-web" ? "Website" : "—"),
}));
vi.mock("@/features/job-statuses/lib", () => ({
  useJobStatusName: () => () => "—",
}));
vi.mock("@/features/custom-fields/hooks", () => ({
  useCustomFields: () => ({
    data: [
      {
        id: "cf-gate",
        name: "Gate Code",
        type: "text",
        group: "Access",
        options: [],
        jobTypeIds: [],
        required: false,
        requiredToClose: false,
        searchable: false,
        priority: 0,
        active: true,
        createdBy: "u1",
        createdAt: "",
        updatedAt: "",
      },
    ],
  }),
}));

const contact: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: [],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: "1042",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Phoenix",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    jobTypeId: "jt-lockout",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    assignedTechIds: [],
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const contactMap = new Map([[contact.id, contact]]);
const withExtension = new Map([
  [contact.id, { ...contact, phoneExtensions: { "+14045551234": "102" } }],
]);
const userMap = new Map<string, User>();

describe("DealsTable", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  /** Workiz: a row click opens the job itself (jobslist_wz_row_click → /root/job/JJENBF/details). */
  it("left-clicking a row opens the job, in this tab", async () => {
    const onOpen = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={onOpen} onRowClick={onRowClick} />,
    );
    await userEvent.click(screen.getByText("Jane Smith"));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("⌘/Ctrl-click opens the job in a new tab instead", () => {
    const onRowClick = vi.fn();
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} onRowClick={onRowClick} />,
    );
    fireEvent.click(screen.getByText("Jane Smith"), { metaKey: true });
    expect(openSpy).toHaveBeenCalledWith("/deals/d1", "_blank", "noopener,noreferrer");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  /** Workiz shows a "Quick view" chip under the Job ID; it opens the preview drawer. */
  it("the Quick view chip under the Job ID opens the preview, not the job", async () => {
    const onOpen = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={onOpen} onRowClick={onRowClick} />,
    );
    const chip = screen.getByRole("button", { name: "Quick view 1042" });
    expect(chip).toHaveTextContent("Quick view");
    await userEvent.click(chip);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("right-clicking a row opens the full job in a new tab and suppresses the browser menu", () => {
    const onOpen = vi.fn();
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={onOpen} />,
    );
    // fireEvent returns false when preventDefault was called — the native
    // context menu must not appear.
    const menuShown = fireEvent.contextMenu(screen.getByText("Jane Smith"));
    expect(menuShown).toBe(false);
    expect(openSpy).toHaveBeenCalledWith("/deals/d1", "_blank", "noopener,noreferrer");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("prints the Job ID plain in the first column — no #, no link icon (list_01)", () => {
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent("Job ID");
    const id = screen.getByText("1042");
    expect(id.closest("td")!.cellIndex).toBe(0);
    expect(screen.queryByText("#1042")).toBeNull();
    expect(screen.queryByRole("link", { name: /new tab/i })).toBeNull();
  });

  it("the client's number is a tel: link that does not open the job", async () => {
    const onRowClick = vi.fn();
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} onRowClick={onRowClick} />,
    );
    const tel = screen.getByRole("link", { name: "(404) 555-1234" });
    expect(tel).toHaveAttribute("href", "tel:+14045551234");
    tel.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(tel);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  /** One line under the client's name, never two: company, else the number, else the email. */
  it("puts the company under the name before the number, and the email only when there is neither", () => {
    const { rerender } = render(
      <DealsTable deals={[deal({ clientCompanyName: "The City of Aurora" })]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    expect(screen.getByText("The City of Aurora")).toBeInTheDocument();
    expect(screen.queryByText("(404) 555-1234")).toBeNull();

    const noPhone = new Map([[contact.id, { ...contact, phones: [], emails: ["jane@example.com"] }]]);
    rerender(<DealsTable deals={[deal()]} contactMap={noPhone} userMap={userMap} onOpen={vi.fn()} />);
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
  });

  it("clicking the Scheduled header flips the day order, and its bar says which way", async () => {
    const onSortScheduled = vi.fn();
    const { rerender } = render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} sort="none" onSortScheduled={onSortScheduled} />,
    );
    const head = () => screen.getByRole("columnheader", { name: "Scheduled" });
    expect(head().className).toContain("shadow-[inset_0_3px_0_0_rgba(0,0,0,0.6)]");
    await userEvent.click(screen.getByRole("button", { name: /Sort by Scheduled/ }));
    expect(onSortScheduled).toHaveBeenCalled();
    rerender(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} sort="day_desc" onSortScheduled={onSortScheduled} />,
    );
    expect(head().className).toContain("shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.6)]");
  });

  it("lays the columns out in the order saved in the Visible fields panel", () => {
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} order={["scheduled", "client"]} />,
    );
    expect(screen.getAllByRole("columnheader").map((h) => h.getAttribute("aria-label"))).toEqual([
      "Job ID",
      "Scheduled",
      "Client",
      "Tech",
      "Tags",
      "City",
      "State",
      "Job Type",
    ]);
  });

  it("an empty list says No Jobs Found across the grid, under its header", () => {
    render(<DealsTable deals={[]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />);
    expect(screen.getByText("No Jobs Found")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(8);
  });

  it("has no separate far-right new-tab column anymore", () => {
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(8);
    expect(screen.queryByText("Open in new tab")).toBeNull();
  });

  it("hides a column's header and cells when its field is toggled off", () => {
    render(
      <DealsTable
        deals={[deal({ tagIds: ["t1"] })]}
        contactMap={contactMap}
        userMap={userMap}
        onOpen={vi.fn()}
        visibleFields={{ ...DEFAULT_VISIBLE, tags: false }}
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "Tags" })).toBeNull();
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    // Cells stay aligned with the remaining headers.
    const row = screen.getByText("Jane Smith").closest("tr")!;
    expect(row.querySelectorAll("td")).toHaveLength(7);
  });

  it("renders the default columns when no visibility is passed", () => {
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(8);
  });

  it("can show any deal field — e.g. Source resolved through the catalog", () => {
    render(
      <DealsTable
        deals={[deal({ sourceId: "src-web" })]}
        contactMap={contactMap}
        userMap={userMap}
        onOpen={vi.fn()}
        visibleFields={{ ...DEFAULT_VISIBLE, source: true }}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Source" })).toBeInTheDocument();
    expect(screen.getByText("Website")).toBeInTheDocument();
  });

  it("can show the external company, resolved through the catalog", () => {
    render(
      <DealsTable
        deals={[deal({ externalCompanyId: "ec-1" })]}
        contactMap={contactMap}
        userMap={userMap}
        onOpen={vi.fn()}
        visibleFields={{ ...DEFAULT_VISIBLE, externalCompany: true }}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "External Company" })).toBeInTheDocument();
    expect(screen.getByText("Allied Dispatch Solutions")).toBeInTheDocument();
  });

  it("can show the job's company (hidden by default)", () => {
    const props = {
      deals: [deal({ businessProfileId: "bp-2", businessProfileName: "KeyPro" })],
      contactMap,
      userMap,
      onOpen: vi.fn(),
    };
    const { rerender } = render(<DealsTable {...props} visibleFields={DEFAULT_VISIBLE} />);
    expect(screen.queryByRole("columnheader", { name: "Company" })).not.toBeInTheDocument();
    rerender(<DealsTable {...props} visibleFields={{ ...DEFAULT_VISIBLE, company: true }} />);
    expect(screen.getByRole("columnheader", { name: "Company" })).toBeInTheDocument();
    expect(screen.getByText("KeyPro")).toBeInTheDocument();
  });

  it("renders an enabled custom field as a column with the deal's answer", () => {
    render(
      <DealsTable
        deals={[deal({ customFields: { "cf-gate": "4417" } })]}
        contactMap={contactMap}
        userMap={userMap}
        onOpen={vi.fn()}
        visibleFields={{ ...DEFAULT_VISIBLE, "cf:cf-gate": true }}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Gate Code" })).toBeInTheDocument();
    expect(screen.getByText("4417")).toBeInTheDocument();
  });

  it("keeps the job number even when every optional field is hidden", () => {
    const none = Object.fromEntries(
      JOB_FIELDS.map((f) => [f.id, false]),
    ) as VisibleFields;
    render(
      <DealsTable
        deals={[deal()]}
        contactMap={contactMap}
        userMap={userMap}
        onOpen={vi.fn()}
        visibleFields={none}
      />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(1);
    expect(screen.getByText("1042")).toBeInTheDocument();
  });

  /**
   * The jobs list is where a tech picks up the number before heading out — so
   * it has to say what to press once the line answers, not just the number.
   */
  /**
   * Workiz's dispatch stamps. Both columns are opt-in, so a preference saved
   * before they existed is unchanged.
   */
  describe("Sent / Seen columns", () => {
    // Today at that clock time. The stamp a dispatcher reads is the time alone
    // only while it happened today (`formatStamp`), so a fixture pinned to a
    // calendar date stops matching the day after it was written.
    const at = (h: number, m: number) => {
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const sentSeen: VisibleFields = { ...DEFAULT_VISIBLE, sent: true, seen: true };

    it("is off by default", () => {
      expect(DEFAULT_VISIBLE.sent).toBe(false);
      expect(DEFAULT_VISIBLE.seen).toBe(false);
      render(
        <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
      );
      expect(screen.queryByRole("columnheader", { name: "Sent" })).toBeNull();
      expect(screen.queryByRole("columnheader", { name: "Seen" })).toBeNull();
    });

    it("shows when the job went out, over which channels, and when it was opened", () => {
      render(
        <DealsTable
          deals={[
            deal({
              sentToTechAt: at(12, 10),
              sentToTechVia: ["sms", "email"],
              seenByTechAt: at(12, 14),
            }),
          ]}
          contactMap={contactMap}
          userMap={userMap}
          onOpen={vi.fn()}
          visibleFields={sentSeen}
        />,
      );
      expect(screen.getByRole("columnheader", { name: "Sent" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Seen" })).toBeInTheDocument();
      expect(screen.getByText("12:10 PM")).toBeInTheDocument();
      expect(screen.getByText("SMS & Email")).toBeInTheDocument();
      expect(screen.getByText("12:14 PM")).toBeInTheDocument();
    });

    it("leaves a dash on a job nobody has been sent or has opened", () => {
      render(
        <DealsTable
          deals={[deal()]}
          contactMap={contactMap}
          userMap={userMap}
          onOpen={vi.fn()}
          visibleFields={sentSeen}
        />,
      );
      const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
      const row = screen.getByText("Jane Smith").closest("tr")!;
      const cells = [...row.querySelectorAll("td")].map((c) => c.textContent);
      expect(cells[headers.indexOf("Sent")]).toBe("—");
      expect(cells[headers.indexOf("Seen")]).toBe("—");
    });
  });

  it("shows the client's extension beside their number", () => {
    render(
      <DealsTable deals={[deal()]} contactMap={withExtension} userMap={userMap} onOpen={vi.fn()} />,
    );
    expect(screen.getByText("(404) 555-1234 ext. 102")).toBeInTheDocument();
  });
});

/**
 * Імена приїжджають разом із рядками (`included`), а не окремим запитом.
 *
 * Клієнта таблиця називає навіть тоді, коли контакт не завантажений зовсім:
 * контакти тепер тягнуться лише під колонки, які показують їхні дані.
 */
describe("DealsTable — names that came with the rows", () => {
  const sideloaded = new Map([["c1", { id: "c1", firstName: "Jane", lastName: "Smith" }]]);

  it("names the client from the side-loaded names, with no contact in hand", () => {
    render(
      <DealsTable
        deals={[deal()]}
        contactMap={new Map()}
        clientNames={sideloaded}
        userMap={userMap}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });

  it("still prefers the name the job itself carries", () => {
    render(
      <DealsTable
        deals={[deal({ clientName: { firstName: "Ivan", lastName: "Koval" } })]}
        contactMap={new Map()}
        clientNames={sideloaded}
        userMap={userMap}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Ivan Koval")).toBeInTheDocument();
    expect(screen.queryByText("Jane Smith")).toBeNull();
  });

  /**
   * Side-loaded names are names and nothing else: a number still comes from
   * the contact, which crm masks per caller.
   */
  it("carries no number of its own — the sub-line stays empty without a contact", () => {
    const { container } = render(
      <DealsTable
        deals={[{ ...deal(), phones: ["+14045550199"] }]}
        contactMap={new Map()}
        clientNames={sideloaded}
        userMap={userMap}
        onOpen={vi.fn()}
        visibleFields={{ client: true, phone: true }}
      />,
    );
    expect(container.querySelector("tbody")?.textContent).not.toContain("0199");
  });
});

describe("zebra striping", () => {
  it("greys every other job row, the way the Workiz grid does", () => {
    const rows = [deal(), { ...deal(), id: "d2" }, { ...deal(), id: "d3" }];
    const { container } = render(
      <DealsTable deals={rows} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    const bodyRows = Array.from(
      container.querySelectorAll("tbody tr:not([aria-hidden])"),
    ) as HTMLElement[];
    expect(bodyRows).toHaveLength(3);
    // The striping lives on the primitive's tbody, so every table gets it.
    expect(container.querySelector("tbody")?.className).toContain(
      "[&>tr:nth-child(odd)]:bg-muted",
    );
  });

  it("pads a short list with blank striped rows to ten, as Workiz's grid does", () => {
    const { container } = render(
      <DealsTable deals={[deal(), { ...deal(), id: "d2" }]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"]')).toHaveLength(8);
  });
});

describe("the Workiz grid", () => {
  function grid() {
    return render(
      <DealsTable
        deals={[deal(), { ...deal(), id: "d2" }]}
        contactMap={contactMap}
        userMap={userMap}
        onOpen={vi.fn()}
      />,
    ).container;
  }

  it("rules every column, the way their grid does", () => {
    // list_01_submitted: a solid #cccccc rule between header cells, a dotted
    // #cfcfcf one between body cells.
    const container = grid();
    const heads = Array.from(container.querySelectorAll("thead th"));
    const cells = Array.from(container.querySelectorAll("tbody tr:first-child td"));
    expect(heads.length).toBeGreaterThan(1);
    expect(cells.length).toBeGreaterThan(1);
    for (const el of heads) {
      expect(el.className).toContain("border-r");
      expect(el.className).toContain("border-input");
      // …except the outer edge, which the wrapper already draws.
      expect(el.className).toContain("last:border-r-0");
    }
    for (const el of cells) {
      expect(el.className).toContain("border-r");
      expect(el.className).toContain("border-dotted");
      expect(el.className).toContain("border-table-border");
      expect(el.className).toContain("last:border-r-0");
    }
  });

  it("sits the header on the grey strip", () => {
    const container = grid();
    expect(container.querySelector("thead")?.className).toMatch(
      /(^|\s)bg-muted(\s|$)/,
    );
  });
});

/**
 * Сітка не має смикатись між першим і другим кадром.
 *
 * Дві причини були: авто-розкладка таблиці переміряла колонки, коли приїжджали
 * імена техніків і клієнтів, а клітинки з іменами показували «—», яке потім
 * ставало текстом. Обидві — видимий стрибок під курсором.
 */
describe("DealsTable — a stable first frame", () => {
  it("lays the columns out at declared widths, not by content", () => {
    const { container } = render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={() => {}} />,
    );
    expect(container.querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for the job number and every visible column", () => {
    const { container } = render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={() => {}} />,
    );
    const cols = [...container.querySelectorAll("colgroup col")];
    const headers = container.querySelectorAll("thead th");
    expect(cols).toHaveLength(headers.length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  // «—» — це відповідь, і хибна: поставити її, а через кадр замінити іменем,
  // і є той самий стрибок.
  it("holds a line for a dispatcher whose name has not landed yet", () => {
    const { container } = render(
      <DealsTable
        deals={[deal()]}
        contactMap={contactMap}
        userMap={new Map()}
        namesLoading
        onOpen={() => {}}
        visibleFields={{ dispatcher: true }}
      />,
    );
    expect(container.querySelector("tbody .animate-pulse")).toBeTruthy();
  });

  it("says “—” once the lookup is done and there is genuinely nobody", () => {
    const { container } = render(
      <DealsTable
        deals={[deal()]}
        contactMap={contactMap}
        userMap={new Map()}
        onOpen={() => {}}
        visibleFields={{ dispatcher: true }}
      />,
    );
    expect(container.querySelector("tbody .animate-pulse")).toBeNull();
    expect(container.querySelector("tbody")?.textContent).toContain("—");
  });
});

describe("DealsTableSkeleton", () => {
  it("has the same header and column widths as the table it stands in for", () => {
    const { container: real } = render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={() => {}} />,
    );
    const { container: shell } = render(<DealsTableSkeleton />);

    const widths = (c: Element) =>
      [...c.querySelectorAll("colgroup col")].map((x) => (x as HTMLElement).style.width);
    expect(widths(shell)).toEqual(widths(real));
    expect(shell.querySelectorAll("thead th")).toHaveLength(real.querySelectorAll("thead th").length);
  });

  it("fills the space with rows rather than one short block", () => {
    const { container } = render(<DealsTableSkeleton rows={12} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(12);
  });
});

/**
 * Маскування номерів.
 *
 * `contacts.view_numbers` ховає клієнтські номери всюди, де вони спливають, —
 * і на сторінці роботи теж. Маскування — це ВІДСУТНІСТЬ гранту: crm віддає
 * контакт уже без номерів тому, хто його не має.
 *
 * Робота несе власну копію номерів (`deal.phones`), і deal-сервіс їх не
 * маскує взагалі. Читати їх у цій таблиці означало б роздати номери кожному,
 * хто має `deals.view`, — тобто обійти грант. Тому джерело тут лише контакт.
 */
describe("DealsTable — client numbers", () => {
  const withJobPhones = () => ({
    ...deal(),
    phones: ["+14045550199"],
    phoneExtensions: { "+14045550199": "77" },
  });

  it("shows nothing when the contact came back without numbers", () => {
    // crm already stripped them: this viewer lacks `contacts.view_numbers`.
    const masked = { ...contact, phones: [] };
    const { container } = render(
      <DealsTable
        deals={[withJobPhones()]}
        contactMap={new Map([[masked.id, masked]])}
        userMap={userMap}
        onOpen={() => {}}
        visibleFields={{ phone: true }}
      />,
    );
    expect(container.querySelector("tbody")?.textContent).not.toContain("0199");
    expect(container.querySelector("tbody")?.textContent).toContain("—");
  });

  it("never falls back to the copy the job carries", () => {
    const { container } = render(
      <DealsTable
        deals={[withJobPhones()]}
        contactMap={new Map()}
        userMap={userMap}
        onOpen={() => {}}
        visibleFields={{ phone: true }}
      />,
    );
    expect(container.querySelector("tbody")?.textContent).not.toContain("0199");
  });

  it("shows the number when the contact does carry it", () => {
    const { container } = render(
      <DealsTable
        deals={[withJobPhones()]}
        contactMap={contactMap}
        userMap={userMap}
        onOpen={() => {}}
        visibleFields={{ phone: true }}
      />,
    );
    expect(container.querySelector("tbody")?.textContent).toContain("555");
  });
});

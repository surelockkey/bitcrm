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
import { DealsTable } from "./deals-table";

// Resolve job-type ids to names without a QueryClient/live catalog.
vi.mock("@/features/job-types/lib", () => ({
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

  it("left-clicking a row opens the preview drawer, not a new tab", async () => {
    const onOpen = vi.fn();
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={onOpen} />,
    );
    await userEvent.click(screen.getByText("Jane Smith"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
    expect(openSpy).not.toHaveBeenCalled();
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

  it("keeps the browser's own context menu on the job-number link", () => {
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    // A real link's right-click menu (copy address, etc.) stays native.
    const menuShown = fireEvent.contextMenu(screen.getByRole("link", { name: /new tab/i }));
    expect(menuShown).toBe(true);
  });

  it("the job number itself is the new-tab link, sitting in the first column", () => {
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    const link = screen.getByRole("link", { name: /new tab/i });
    expect(link).toHaveAttribute("href", "/deals/d1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    // The number is the click target — no reaching for the far edge of the row.
    expect(link).toHaveTextContent("#1042");
    const cell = link.closest("td");
    expect(cell).not.toBeNull();
    expect(cell!.cellIndex).toBe(0);
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
    expect(screen.getByRole("columnheader", { name: "External company" })).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: /new tab/i })).toHaveTextContent("#1042");
  });

  it("does not open the preview when the new-tab link is clicked", async () => {
    const onOpen = vi.fn();
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={onOpen} />,
    );
    // jsdom would navigate on a real anchor click; prevent that noise.
    const link = screen.getByRole("link", { name: /new tab/i });
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    expect(onOpen).not.toHaveBeenCalled();
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

describe("zebra striping", () => {
  it("greys every other job row, the way the Workiz grid does", () => {
    const rows = [deal(), { ...deal(), id: "d2" }, { ...deal(), id: "d3" }];
    const { container } = render(
      <DealsTable deals={rows} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    const bodyRows = Array.from(
      container.querySelectorAll("tbody tr"),
    ) as HTMLElement[];
    expect(bodyRows).toHaveLength(3);
    // The striping lives on the primitive's tbody, so every table gets it.
    expect(container.querySelector("tbody")?.className).toContain(
      "[&>tr:nth-child(odd)]:bg-muted",
    );
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
    // Sampled off their jobs screenshot: a #cfcfcf vertical rule between every
    // column, in the body and in the header alike.
    const container = grid();
    const heads = Array.from(container.querySelectorAll("thead th"));
    const cells = Array.from(container.querySelectorAll("tbody tr:first-child td"));
    expect(heads.length).toBeGreaterThan(1);
    expect(cells.length).toBeGreaterThan(1);
    for (const el of [...heads, ...cells]) {
      expect(el.className).toContain("border-r");
      expect(el.className).toContain("border-table-border");
      // …except the outer edge, which the wrapper already draws.
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

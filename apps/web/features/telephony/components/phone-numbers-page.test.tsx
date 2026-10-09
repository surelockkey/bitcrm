import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneNumbersPage } from "./phone-numbers-page";

const mocks = vi.hoisted(() => ({
  can: vi.fn(() => true),
  numbers: [] as unknown[],
  settings: [{ phoneNumber: "+14045551234", sourceId: "src-google-ads", businessProfileId: "bp-2" }],
  setTechLine: vi.fn(),
  release: vi.fn(),
  updateSettings: vi.fn(),
  assignFlow: vi.fn(),
  flows: [] as unknown[],
}));

/** The roster both suites start from; each restores it after mutating. */
const DEFAULT_NUMBERS = [
  { sid: "PN1", phoneNumber: "+15412830739", friendlyName: "Main line", dateCreated: "2020-09-28T03:11:00.000Z" },
  { sid: "PN2", phoneNumber: "+14045551234", friendlyName: "Ads line" },
];

/** Flow "f1" answers the ads line; "f2" answers nothing yet. */
const DEFAULT_FLOWS = [
  { id: "f1", name: "Ads flow", numbers: ["+14045551234"], nodes: {}, entryNodeId: "a", active: true },
  { id: "f2", name: "Main flow", numbers: [], nodes: {}, entryNodeId: "a", active: true },
];

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: mocks.can }),
}));
vi.mock("../numbers-hooks", () => ({
  useNumbers: () => ({ data: mocks.numbers, isLoading: false }),
  useReleaseNumber: () => ({ mutate: mocks.release, isPending: false }),
  useSetTechnicianLine: () => ({ mutate: mocks.setTechLine, isPending: false }),
  useNumberSettings: () => ({ data: mocks.settings, isLoading: false }),
  useUpdateNumberSettings: () => ({
    mutate: mocks.updateSettings,
    isPending: false,
  }),
}));
vi.mock("./buy-number-dialog", () => ({ BuyNumberDialog: () => null }));
vi.mock("../call-flows-hooks", () => ({
  useCallFlows: () => ({ data: mocks.flows, isLoading: false }),
  useAssignNumberFlow: () => ({ mutate: mocks.assignFlow, isPending: false }),
}));
// A plain button standing in for the flow picker: shows the current flow,
// clicking it "picks" flow f2.
vi.mock("./number-flow-select", () => ({
  NumberFlowSelect: ({ value, onChange }: { value?: string; onChange: (v: string) => void }) => (
    <button type="button" onClick={() => onChange("f2")}>
      flow:{value ?? "none"}
    </button>
  ),
}));

// A plain button standing in for the source picker: shows the current value,
// clicking it "picks" a fixed source.
vi.mock("@/features/job-sources/components/job-source-select", () => ({
  JobSourceSelect: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (v: string | undefined) => void;
  }) => (
    <button type="button" onClick={() => onChange("src-picked")}>
      source:{value ?? "none"}
    </button>
  ),
}));

vi.mock("@/features/business-profiles/components/business-profile-select", () => ({
  BusinessProfileSelect: ({
    value,
    onChange,
    noneLabel,
  }: {
    value?: string | null;
    onChange: (v: string | null) => void;
    noneLabel?: string;
  }) => (
    <span>
      <button type="button" onClick={() => onChange("bp-picked")}>
        company:{value ?? "none"}
      </button>
      <button type="button" onClick={() => onChange(null)}>
        {noneLabel}:{value ?? "none"}
      </button>
    </span>
  ),
}));
// The catalogs the pickers name their values from; the page asks for them
// up front so the rows are drawn named.
vi.mock("@/features/job-sources/active-hooks", () => ({
  useActiveJobSources: () => ({ data: [] }),
}));
vi.mock("@/features/business-profiles/hooks", () => ({
  useActiveBusinessProfiles: () => ({ data: [], active: [] }),
}));

beforeEach(() => {
  mocks.can.mockReturnValue(true);
  mocks.updateSettings.mockReset();
  mocks.assignFlow.mockReset();
  mocks.numbers = DEFAULT_NUMBERS;
  mocks.flows = DEFAULT_FLOWS;
});

/**
 * Workiz Phone → Phone numbers (pg_settings_phone_wz_numbers): its words and
 * "Add number" over a react-table — Number | Ad group | Flow | Created |
 * Action — with ours (Company, the technician line) kept in Workiz's style.
 */
describe("PhoneNumbersPage — Workiz's numbers list", () => {
  it("draws Workiz's words, Add number and the columns in Workiz's order", () => {
    render(<PhoneNumbersPage />);
    expect(screen.getByText(/Manage your phone numbers and assign them to call flows/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add number" })).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Number", "Ad group", "Flow", "Company", "Created", "Action"]);
  });

  it("writes when each number was bought as Workiz does", () => {
    render(<PhoneNumbersPage />);
    expect(screen.getByText("Sun Sep 27, 2020 11:11 pm")).toBeInTheDocument();
  });

  it("finds a number by what is typed in the Search box", async () => {
    const u = userEvent.setup();
    render(<PhoneNumbersPage />);
    await u.type(screen.getByRole("searchbox", { name: "Search" }), "404555");
    expect(screen.getByText("(404) 555-1234")).toBeInTheDocument();
    expect(screen.queryByText("(541) 283-0739")).not.toBeInTheDocument();
  });

  it("hides Add number and the Remove links from a reader who may not change settings", () => {
    mocks.can.mockImplementation(((_r: string, action?: string) => action !== "edit") as never);
    render(<PhoneNumbersPage />);
    expect(screen.queryByRole("button", { name: "Add number" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });
});

describe("PhoneNumbersPage — the flow per number", () => {
  it("shows the flow that answers each number", () => {
    render(<PhoneNumbersPage />);
    expect(screen.getByText("flow:f1")).toBeInTheDocument();
    expect(screen.getByText("flow:none")).toBeInTheDocument();
  });

  it("moves a number onto the flow picked for it", async () => {
    const u = userEvent.setup();
    render(<PhoneNumbersPage />);
    await u.click(screen.getByText("flow:none"));
    expect(mocks.assignFlow).toHaveBeenCalledWith({ number: "+15412830739", toFlowId: "f2" });
  });

  it("takes a number off its flow with Remove flow, offered only where there is one", async () => {
    const u = userEvent.setup();
    render(<PhoneNumbersPage />);
    const removes = screen.getAllByRole("button", { name: "Remove flow" });
    expect(removes).toHaveLength(1);
    await u.click(removes[0]);
    expect(mocks.assignFlow).toHaveBeenCalledWith({ number: "+14045551234", toFlowId: null });
  });
});

/**
 * The technician line is a workspace-level designation that happens to be
 * edited per number: exactly one number holds it, so the control reads as
 * "make this the line" rather than a per-number setting.
 */
describe("PhoneNumbersPage — technician line", () => {
  beforeEach(() => {
    mocks.setTechLine.mockReset();
    mocks.numbers = [
      { sid: "PN1", phoneNumber: "+14098777774", friendlyName: "Tech line", technicianLine: true },
      { sid: "PN2", phoneNumber: "+15412830739", friendlyName: "Main", technicianLine: false },
    ];
  });

  it("badges the number that currently holds it", () => {
    render(<PhoneNumbersPage />);
    expect(screen.getByText(/technician line/i)).toBeInTheDocument();
  });

  it("offers to designate a number that does not hold it", async () => {
    render(<PhoneNumbersPage />);

    await userEvent.click(
      screen.getByRole("button", { name: /make technician line/i }),
    );

    expect(mocks.setTechLine).toHaveBeenCalledWith({ sid: "PN2", on: true });
  });

  it("offers to release the one that does", async () => {
    render(<PhoneNumbersPage />);

    await userEvent.click(
      screen.getByRole("button", { name: /clear technician line/i }),
    );

    expect(mocks.setTechLine).toHaveBeenCalledWith({ sid: "PN1", on: false });
  });

  /** Only ever one — the badge and the release control are both singular. */
  it("shows exactly one designated number", () => {
    render(<PhoneNumbersPage />);

    expect(
      screen.getAllByRole("button", { name: /clear technician line/i }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: /make technician line/i }),
    ).toHaveLength(1);
  });

  it("shows no badge when no number has been designated", () => {
    mocks.numbers = [
      { sid: "PN2", phoneNumber: "+15412830739", friendlyName: "Main", technicianLine: false },
    ];

    render(<PhoneNumbersPage />);

    expect(screen.queryByText(/^technician line$/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /make technician line/i }),
    ).toBeInTheDocument();
  });
});

describe("PhoneNumbersPage — ad group (job source) per number", () => {
  it("shows each number's assigned source under Workiz's Ad group", () => {
    render(<PhoneNumbersPage />);

    expect(screen.getByRole("columnheader", { name: "Ad group" })).toBeInTheDocument();
    expect(screen.getByText("source:src-google-ads")).toBeInTheDocument();
    expect(screen.getByText("source:none")).toBeInTheDocument();
  });

  it("saves a new assignment for the number", async () => {
    const u = userEvent.setup();
    render(<PhoneNumbersPage />);

    await u.click(screen.getByText("source:none"));

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      phoneNumber: "+15412830739",
      sourceId: "src-picked",
    });
  });

  it("clears it with Remove ad group, offered only where one is set", async () => {
    const u = userEvent.setup();
    render(<PhoneNumbersPage />);
    const removes = screen.getAllByRole("button", { name: "Remove ad group" });
    expect(removes).toHaveLength(1);
    await u.click(removes[0]);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ phoneNumber: "+14045551234", sourceId: null });
  });
});

describe("PhoneNumbersPage — company per number", () => {
  it("shows a Company column after Flow with each number's override", () => {
    render(<PhoneNumbersPage />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.indexOf("Company")).toBe(headers.indexOf("Flow") + 1);
    expect(screen.getByText("company:bp-2")).toBeInTheDocument();
    expect(screen.getByText("company:none")).toBeInTheDocument();
    // The hint rides on each row's picker (Workiz's headers carry no ⓘ).
    expect(screen.getAllByTitle("Overrides the call flow's company")).toHaveLength(2);
  });

  it("saves only the company, leaving the source alone", async () => {
    const u = userEvent.setup();
    render(<PhoneNumbersPage />);
    await u.click(screen.getByText("company:none"));
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      phoneNumber: "+15412830739",
      businessProfileId: "bp-picked",
    });
  });

  it("clears the override back to the call flow's company", async () => {
    const u = userEvent.setup();
    render(<PhoneNumbersPage />);
    await u.click(screen.getByText("Call flow's company:bp-2"));
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      phoneNumber: "+14045551234",
      businessProfileId: null,
    });
  });
});

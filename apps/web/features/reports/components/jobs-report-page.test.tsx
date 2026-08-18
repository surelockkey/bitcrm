import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  DealStatus,
  JobSuperStatus,
} from "@bitcrm/types";
import type { Contact, Deal } from "@bitcrm/types";

const { mocks } = vi.hoisted(() => ({
  mocks: { deals: [] as unknown[], perms: true },
}));

function deal(over: Partial<Deal>): Deal {
  return {
    id: "d1",
    dealNumber: "AAAAAA",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Phoenix",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    jobTypeId: "jt-1",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    assignedTechIds: [],
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "",
    ...over,
  };
}

const contact: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: ["jane@acme.com"],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => mocks.perms }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useDeals: () => ({ data: mocks.deals, isLoading: false }),
  useContactMap: () => ({ map: new Map([[contact.id, contact]]) }),
  useUserMap: () => ({ map: new Map() }),
}));
vi.mock("@/features/job-types/lib", () => ({
  useJobTypeName: () => () => "Lockout",
  activeJobTypes: () => [],
}));
vi.mock("@/features/job-sources/hooks", () => ({ useJobSources: () => ({ data: [] }) }));
vi.mock("@/features/job-sources/lib", () => ({
  activeJobSources: () => [],
  useJobSourceName: () => () => "—",
}));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [] }) }));
vi.mock("@/features/job-statuses/hooks", () => ({ useJobStatuses: () => ({ data: [] }) }));
vi.mock("@/features/job-statuses/lib", () => ({
  activeJobStatuses: () => [],
  useJobStatusName: () => () => "—",
}));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));
vi.mock("@/features/job-tags/lib", () => ({ activeJobTags: () => [] }));
vi.mock("@/features/job-tags/components/job-tag-chips", () => ({ JobTagChips: () => null }));
vi.mock("@/features/clients/hooks", () => ({ useCompanyMap: () => ({ map: new Map() }) }));
vi.mock("@/features/custom-fields/hooks", () => ({ useCustomFields: () => ({ data: [] }) }));

import { JobsReportPage } from "./jobs-report-page";

describe("JobsReportPage", () => {
  beforeEach(() => {
    mocks.perms = true;
    mocks.deals = [
      deal({ id: "a", dealNumber: "A11111" }),
      deal({ id: "b", dealNumber: "B22222", superStatus: JobSuperStatus.CANCELED }),
    ];
  });

  it("lists jobs with report columns", () => {
    render(<JobsReportPage />);

    expect(screen.getByText("A11111")).toBeInTheDocument();
    expect(screen.getByText("B22222")).toBeInTheDocument();
    for (const col of ["Job #", "Client", "Type", "Created", "Scheduled", "Status", "Total", "Source"]) {
      expect(screen.getByRole("columnheader", { name: col })).toBeInTheDocument();
    }
  });

  it("narrows by search", () => {
    render(<JobsReportPage />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "B22222" } });

    expect(screen.queryByText("A11111")).not.toBeInTheDocument();
    expect(screen.getByText("B22222")).toBeInTheDocument();
  });

  it("pages from both the top and the bottom pager", () => {
    mocks.deals = Array.from({ length: 12 }, (_, i) =>
      deal({ id: `d${i}`, dealNumber: `NUM${String(i).padStart(3, "0")}` }),
    );
    render(<JobsReportPage />);

    // Two pagers, both live.
    const nexts = screen.getAllByRole("button", { name: "Next page" });
    expect(nexts).toHaveLength(2);

    // Page size down to 10 so 12 rows split into two pages.
    fireEvent.change(screen.getAllByRole("combobox", { name: "Rows per page" })[0], {
      target: { value: "10" },
    });

    expect(screen.getByText("NUM000")).toBeInTheDocument();
    expect(screen.queryByText("NUM011")).not.toBeInTheDocument();

    fireEvent.click(nexts[1]);
    expect(screen.queryByText("NUM000")).not.toBeInTheDocument();
    expect(screen.getByText("NUM011")).toBeInTheDocument();
    expect(screen.getAllByText(/11–12 of 12/).length).toBeGreaterThan(0);
  });

  it("offers the date-field switch, presets and export", () => {
    render(<JobsReportPage />);

    expect(screen.getByRole("combobox", { name: "Date field" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Date preset" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("blocks users without the reports permission", () => {
    mocks.perms = false;
    render(<JobsReportPage />);

    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });
});

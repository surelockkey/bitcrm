import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  JobSuperStatus,
  DealStatus,
} from "@bitcrm/types";
import type { Contact, Deal } from "@bitcrm/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// next/link needs the App Router context; swap it for a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Read-only view keeps the render lean (no phone/address editors) and proves the
// client link is not gated behind edit permissions.
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => false }),
}));

// Catalog widgets and sibling tabs fetch via react-query; stub them so the page
// renders without a QueryClient. None are relevant to the client link.
vi.mock("@/features/job-statuses/components/job-status-select", () => ({ JobStatusSelect: () => null }));
vi.mock("@/features/job-tags/components/job-tag-combobox", () => ({ JobTagCombobox: () => null }));
vi.mock("@/features/job-types/components/job-type-select", () => ({ JobTypeSelect: () => null }));
vi.mock("@/features/job-sources/components/job-source-select", () => ({ JobSourceSelect: () => null }));
vi.mock("./schedule-field", () => ({ ScheduleField: () => null }));
vi.mock("./assigned-techs", () => ({ AssignedTechs: () => null, TechChips: () => null }));
vi.mock("./deal-notes-card", () => ({ DealNotesCard: () => null }));

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

const deal: Deal = {
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
};

vi.mock("../hooks", () => ({
  useDeal: () => ({ data: deal, isLoading: false }),
  useDeleteDeal: () => ({ mutate: vi.fn() }),
  useUpdateDeal: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveStatus: () => ({ mutate: vi.fn() }),
  useDealTimeline: () => ({
    data: { pages: [] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useAddNote: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/clients/hooks", () => ({
  useContact: () => ({ data: contact }),
  useUpdateContact: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { DealDetailPage } from "./deal-detail-page";

describe("DealDetailPage", () => {
  it("links from the job to the client page", () => {
    render(<DealDetailPage dealId="d1" />);

    const link = screen.getByRole("link", { name: /view client/i });
    expect(link).toHaveAttribute("href", "/contacts/c1");
  });

  it("hangs the timeline on the right edge instead of a tab", () => {
    render(<DealDetailPage dealId="d1" />);

    // Exactly one "timeline" button — the hanging handle, not a tab. getByRole
    // throws if a timeline tab button were still rendered next to it.
    const handle = screen.getByRole("button", { name: /timeline/i });
    expect(handle).toHaveAttribute("aria-expanded", "false");
  });
});

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

// next/link needs the App Router context to render; swap it for a plain anchor
// so this stays a focused unit test.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The Sheet is a Radix portal/animation wrapper; render its children directly.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));

vi.mock("@/features/job-types/lib", () => ({
  useJobTypeName: () => (id: string | undefined) => id ?? "—",
}));

// Catalog widgets fetch via react-query; stub them so the drawer renders
// without a QueryClient (they're irrelevant to the client link).
vi.mock("@/features/job-tags/components/job-tag-chips", () => ({ JobTagChips: () => null }));
vi.mock("@/features/job-tags/components/job-tag-combobox", () => ({ JobTagCombobox: () => null }));
vi.mock("@/features/job-statuses/components/job-status-select", () => ({ JobStatusSelect: () => null }));
// Custom-fields catalog fetches via react-query; stub it (empty catalog → the
// read-only custom-fields row stays hidden) so the drawer renders sans QueryClient.
vi.mock("@/features/custom-fields/hooks", () => ({ useCustomFields: () => ({ data: [] }) }));

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
  useDealProducts: () => ({ data: [] }),
  useContactMap: () => ({ map: new Map([[contact.id, contact]]) }),
  useUserMap: () => ({ map: new Map() }),
  useUpdateDeal: () => ({ mutate: vi.fn() }),
  useSetDealTags: () => ({ mutate: vi.fn() }),
  useMoveStatus: () => ({ mutate: vi.fn() }),
}));

import { DealQuickView } from "./deal-quick-view";

describe("DealQuickView", () => {
  it("links the client name to the contact page so you can jump from the job to the client", () => {
    render(<DealQuickView dealId="d1" open onOpenChange={() => {}} />);

    const link = screen.getByRole("link", { name: "Jane Smith" });
    expect(link).toHaveAttribute("href", "/contacts/c1");
  });
});

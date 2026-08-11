import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
import type { Contact, Deal } from "@bitcrm/types";
import { DEFAULT_VISIBLE } from "../fields";
import { useJobFieldsStore } from "../fields-store";
import { DealsPage } from "./deals-page";

// next/link needs the App Router context; swap it for a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, isTechnician: false }),
}));

// The page and table read catalogs/data via react-query; pin them all so this
// renders without a QueryClient and focuses on the fields UI.
vi.mock("../hooks", () => ({
  useDeals: () => ({ data: mocks.deals, isLoading: false, isError: false }),
  useContactMap: () => ({ map: mocks.contactMap }),
  useUserMap: () => ({ map: new Map() }),
}));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [] }) }));
vi.mock("@/features/job-types/lib", () => ({
  activeJobTypes: () => [],
  useJobTypeName: () => () => "Lockout",
}));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));
vi.mock("@/features/job-tags/lib", () => ({ activeJobTags: () => [] }));
vi.mock("@/features/job-tags/components/job-tag-chips", () => ({ JobTagChips: () => null }));
vi.mock("@/features/custom-fields/hooks", () => ({ useCustomFields: () => ({ data: [] }) }));
vi.mock("./deal-quick-view", () => ({ DealQuickView: () => null }));

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

const mocks = vi.hoisted(() => ({
  deals: [] as unknown[],
  contactMap: new Map<string, unknown>(),
}));
mocks.deals = [deal];
mocks.contactMap = new Map([[contact.id, contact]]);

beforeEach(() => {
  localStorage.clear();
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE } });
});

describe("DealsPage fields visibility", () => {
  it("shows the Fields button in the toolbar", () => {
    render(<DealsPage />);
    expect(screen.getByRole("button", { name: /fields/i })).toBeInTheDocument();
  });

  it("unchecking a field hides its column immediately", async () => {
    const u = userEvent.setup();
    render(<DealsPage />);
    expect(screen.getByRole("columnheader", { name: "Tags" })).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /fields/i }));
    await u.click(screen.getByRole("menuitemcheckbox", { name: "Tags" }));
    // The modal menu hides the page from the a11y tree while open.
    await u.keyboard("{Escape}");

    expect(screen.queryByRole("columnheader", { name: "Tags" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Client" })).toBeInTheDocument();
  });

  it("hidden fields survive a reload", async () => {
    const u = userEvent.setup();
    const first = render(<DealsPage />);
    await u.click(screen.getByRole("button", { name: /fields/i }));
    await u.click(screen.getByRole("menuitemcheckbox", { name: "Scheduled" }));
    first.unmount();

    // Simulate the reload: memory is wiped but the disk survives. Resetting
    // the store also rewrites storage (persist middleware), so snapshot the
    // stored value first and put it back before rehydrating — exactly the
    // state a fresh module load would boot from.
    const saved = localStorage.getItem("bitcrm.jobs-fields")!;
    expect(saved).toContain('"scheduled":false');
    useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE } });
    localStorage.setItem("bitcrm.jobs-fields", saved);
    await useJobFieldsStore.persist.rehydrate();

    render(<DealsPage />);
    expect(screen.queryByRole("columnheader", { name: "Scheduled" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Client" })).toBeInTheDocument();
  });
});

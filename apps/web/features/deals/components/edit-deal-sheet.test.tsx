import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DealPriority, type Deal } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("../hooks", () => ({ useUpdateDeal: () => ({ mutate: mocks.mutate, isPending: false }) }));
vi.mock("@/features/custom-fields/hooks", () => ({ useCustomFields: () => ({ data: [] }) }));
vi.mock("./address-autocomplete", () => ({ AddressAutocomplete: () => null }));
vi.mock("@/features/service-areas/components/resolved-area-field", () => ({ ResolvedAreaField: () => null }));
vi.mock("@/features/job-types/components/job-type-select", () => ({ JobTypeSelect: () => null }));
vi.mock("@/features/job-sources/components/job-source-select", () => ({ JobSourceSelect: () => null }));
vi.mock("@/features/external-companies/components/external-company-select", () => ({ ExternalCompanySelect: () => null }));
vi.mock("@/features/job-tags/components/job-tag-picker", () => ({ JobTagPicker: () => null }));
vi.mock("@/features/business-profiles/components/business-profile-select", () => ({
  BusinessProfileSelect: ({ value, onChange }: { value?: string | null; onChange: (v: string) => void }) => (
    <div>
      <span data-testid="company-select">{value ?? ""}</span>
      <button type="button" onClick={() => onChange("bp-2")}>pick company</button>
    </div>
  ),
}));

import { EditDealSheet } from "./edit-deal-sheet";

const deal = {
  id: "d1",
  dealNumber: 1042,
  jobTypeId: "jt1",
  address: { street: "1 Main", city: "Hartford", state: "CT", zip: "06103" },
  priority: DealPriority.NORMAL,
  tagIds: [],
  businessProfileId: "bp-default",
  businessProfileName: "SureLock",
} as unknown as Deal;

describe("EditDealSheet — company", () => {
  it("shows the job's company and saves a new pick", async () => {
    const user = userEvent.setup();
    render(<EditDealSheet deal={deal} open onOpenChange={() => {}} />);
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.getByTestId("company-select")).toHaveTextContent("bp-default");
    await user.click(screen.getByRole("button", { name: "pick company" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ businessProfileId: "bp-2" }),
        expect.anything(),
      ),
    );
  });
});

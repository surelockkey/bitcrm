import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TechnicianProfile } from "@bitcrm/types";

const mutate = vi.fn();
const profile: TechnicianProfile = {
  userId: "tech-1",
  phone: "+15412830739",
  callMaskingEnabled: false,
  gpsTrackingEnabled: false,
  mobileAppInstalled: false,
  status: "active",
  createdAt: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("@/features/technicians/hooks", () => ({
  useProfile: () => ({ data: profile, isLoading: false }),
  useUpdateProfile: () => ({ mutate, isPending: false }),
}));

vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Address line 1" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { SelfProfileForm } from "./self-profile-form";

/**
 * There is one phone number for a person and it lives on the account card
 * above this form. The technician record used to carry a second "dispatch
 * phone", which a technician could fill in and still be unreachable when
 * placing a call.
 */
describe("SelfProfileForm", () => {
  beforeEach(() => mutate.mockClear());

  it("offers no phone field of its own", () => {
    render(<SelfProfileForm technicianId="tech-1" />);
    expect(screen.queryByText(/dispatch phone/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /phone/i })).not.toBeInTheDocument();
  });

  it("saves the home address without touching the phone", async () => {
    render(<SelfProfileForm technicianId="tech-1" />);

    await userEvent.type(screen.getByLabelText("Address line 1"), "1 Peachtree St");
    await userEvent.type(screen.getByPlaceholderText("City"), "Atlanta");
    await userEvent.type(screen.getByPlaceholderText("State"), "GA");
    await userEvent.type(screen.getByPlaceholderText("ZIP"), "30303");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const body = mutate.mock.calls[0][0].body;
    expect(body).not.toHaveProperty("phone");
    expect(body.homeAddress).toMatchObject({ line1: "1 Peachtree St", city: "Atlanta" });
  });
});

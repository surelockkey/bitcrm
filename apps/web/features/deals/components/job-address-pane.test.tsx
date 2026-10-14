import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Address } from "@bitcrm/types";

// The street box is Google Places; the map is Google Maps. Neither is this test's business.
vi.mock("./workiz/address-field", () => ({
  WzAddressField: ({ value, onChange }: { value: string; onChange: (s: string) => void }) => (
    <input aria-label="Address" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/features/clients/components/address-map", () => ({ AddressMap: () => <div data-testid="map" /> }));

import { JobAddressPane } from "./job-address-pane";
import { addressSummary } from "../job-details-form";

const home: Address = { street: "17430 Broadway St", city: "Lockport", state: "IL", zip: "60441", country: "US" };
const shore: Address = { street: "8080 S DuSable Lake Shore Dr", city: "Chicago", state: "IL", zip: "60617", country: "US" };

/**
 * Workiz's Address pane (job_address_properties_open): the Client properties
 * list opens on "Add New Property", then the client's saved addresses.
 * Picking it empties the boxes for a new address, which the job's Save then
 * offers to keep on the client.
 */
describe("JobAddressPane — Add New Property", () => {
  it("is the first row of Client properties and clears the address for a new one", async () => {
    const user = userEvent.setup();
    render(<JobAddressPane open onOpenChange={() => {}} value={home} clientAddresses={[home, shore]} onApply={() => {}} />);

    await user.click(screen.getByRole("combobox", { name: "Client properties" }));
    const rows = screen.getAllByRole("option").map((o) => o.textContent?.trim());
    expect(rows[0]).toBe("Add New Property");
    expect(rows.slice(1)).toEqual([home, shore].map(addressSummary));

    await user.click(screen.getByRole("option", { name: "Add New Property" }));
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "City" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Zip" })).toHaveValue("");
  });
});

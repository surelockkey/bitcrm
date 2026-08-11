import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";
import { MergeContactsDialog } from "./merge-contacts-dialog";

const mutate = vi.fn();
vi.mock("../hooks", () => ({
  useMergeContacts: () => ({ mutate, isPending: false }),
}));

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    firstName: "Jane",
    lastName: "Smith",
    phones: ["+14045551234"],
    emails: [],
    addresses: [],
    type: ContactType.RESIDENTIAL,
    source: ContactSource.MANUAL,
    status: CrmStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const dupA = contact({ id: "c1", firstName: "Jane", lastName: "Smith" });
const dupB = contact({ id: "c2", firstName: "Janet", lastName: "Smith", phones: ["(404) 555-1234"] });
const unique = contact({ id: "c3", firstName: "Bob", lastName: "Jones", phones: ["+14049990000"] });

beforeEach(() => mutate.mockClear());

function renderDialog(contacts: Contact[], onOpenChange = vi.fn()) {
  render(<MergeContactsDialog open onOpenChange={onOpenChange} contacts={contacts} />);
  return onOpenChange;
}

describe("MergeContactsDialog", () => {
  it("lists duplicate groups for the phone criterion by default", () => {
    renderDialog([dupA, dupB, unique]);
    expect(screen.getByText(/2 contacts/)).toBeInTheDocument();
    expect(screen.queryByText(/Bob Jones/)).not.toBeInTheDocument();
  });

  it("shows an empty state when the criterion has no duplicates", () => {
    renderDialog([dupA, unique]);
    expect(screen.getByText(/no duplicates found/i)).toBeInTheDocument();
  });

  it("finds duplicates by name after switching the criterion", async () => {
    const nameA = contact({ id: "c4", firstName: "John", lastName: "Doe", phones: ["+14041111111"] });
    const nameB = contact({ id: "c5", firstName: "john", lastName: "doe", phones: ["+14042222222"] });
    renderDialog([nameA, nameB]);

    expect(screen.getByText(/no duplicates found/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(screen.getByText(/2 contacts/)).toBeInTheDocument();
  });

  it("merges the selected group into the chosen primary", async () => {
    renderDialog([dupA, dupB, unique]);
    await userEvent.click(screen.getByText(/2 contacts/));

    // Both duplicates are pre-selected; make Janet the survivor.
    await userEvent.click(screen.getByRole("radio", { name: /janet smith/i }));
    await userEvent.click(screen.getByRole("button", { name: /merge 2 contacts/i }));

    expect(mutate).toHaveBeenCalledWith(
      { primaryId: "c2", mergeIds: ["c1"] },
      expect.anything(),
    );
  });

  it("disables merging when fewer than two contacts are selected", async () => {
    renderDialog([dupA, dupB, unique]);
    await userEvent.click(screen.getByText(/2 contacts/));

    await userEvent.click(screen.getByRole("checkbox", { name: /janet smith/i }));

    expect(screen.getByRole("button", { name: /merge 1 contact/i })).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("caps the selection at five contacts", async () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      contact({ id: `s${i}`, firstName: `Sam${i}`, lastName: "Same", phones: ["+14047777777"] }),
    );
    renderDialog(six);
    await userEvent.click(screen.getByText(/6 contacts/));

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.filter((b) => b.getAttribute("aria-checked") === "true")).toHaveLength(5);

    // The sixth cannot be added while five are already selected.
    await userEvent.click(boxes[5]);
    expect(boxes[5]).not.toBeChecked();
  });
});

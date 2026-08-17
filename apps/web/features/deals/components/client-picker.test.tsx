import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClientType, ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";

const { createContactMutate } = vi.hoisted(() => ({ createContactMutate: vi.fn() }));

function contact(over: Partial<Contact> = {}): Contact {
  return {
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
    ...over,
  };
}

const jane = contact();
const marcus = contact({
  id: "c2",
  firstName: "Marcus",
  lastName: "Reyes",
  phones: ["+16025550148"],
  emails: [],
  companyId: "co-1",
});

vi.mock("../hooks", () => ({
  useContactMap: () => ({ map: new Map([[jane.id, jane], [marcus.id, marcus]]) }),
}));

vi.mock("@/features/clients/hooks", () => ({
  useContactByPhone: () => ({ data: null, isFetching: false }),
  useCreateContact: () => ({ mutate: createContactMutate, isPending: false }),
  useCompanyMap: () => ({ map: new Map([["co-1", { id: "co-1", title: "Acme Storage" }]]) }),
}));

import { ClientPicker } from "./client-picker";

describe("ClientPicker — search from 3 characters", () => {
  beforeEach(() => createContactMutate.mockReset());

  it("suggests nothing before 3 characters", () => {
    render(<ClientPicker hidden={false} contact={null} onResolved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "ja" } });
    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();
  });

  it("suggests by name and resolves the picked client", () => {
    const onResolved = vi.fn();
    render(<ClientPicker hidden={false} contact={null} onResolved={onResolved} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "jan" } });
    fireEvent.click(screen.getByText("Jane Smith"));

    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), false);
  });

  it("finds a client by a partial phone, formatting-agnostic", () => {
    render(<ClientPicker hidden={false} contact={null} onResolved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "(602) 555" } });
    expect(screen.getByText("Marcus Reyes")).toBeInTheDocument();
    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();
  });

  it("finds a client by their company name", () => {
    render(<ClientPicker hidden={false} contact={null} onResolved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "acme sto" } });
    expect(screen.getByText("Marcus Reyes")).toBeInTheDocument();
  });

  it("offers to create a new client when nothing matches", () => {
    render(<ClientPicker hidden={false} contact={null} onResolved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "nobody here" } });
    expect(screen.getByText(/no client found/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("First name")).toBeInTheDocument();
  });
});

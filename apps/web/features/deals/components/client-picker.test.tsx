import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";

const { createContactMutate, createCompanyMutate } = vi.hoisted(() => ({
  createContactMutate: vi.fn(),
  createCompanyMutate: vi.fn(),
}));

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

const acme = { id: "co-1", title: "Acme Storage" };
vi.mock("@/features/clients/hooks", () => ({
  useContactByPhone: () => ({ data: null, isFetching: false }),
  useCreateContact: () => ({ mutate: createContactMutate, isPending: false }),
  useCreateCompany: () => ({ mutate: createCompanyMutate, isPending: false }),
  useCompanyMap: () => ({ map: new Map([["co-1", acme]]), companies: [acme] }),
}));

// The company picker has its own test; stub it to expose select/create.
vi.mock("@/features/clients/components/company-picker-dialog", () => ({
  CompanyPickerDialog: ({
    open,
    onSelect,
    onCreate,
  }: {
    open: boolean;
    onSelect: (id: string) => void;
    onCreate?: (name: string) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="company picker">
        <button type="button" onClick={() => onSelect("co-1")}>pick existing</button>
        <button type="button" onClick={() => onCreate?.("Globex")}>create company</button>
      </div>
    ) : null,
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

  it("prefills first and last name from a typed name query", () => {
    render(<ClientPicker hidden={false} contact={null} onResolved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Olena Kovalenko" } });
    expect(screen.getByPlaceholderText("First name")).toHaveValue("Olena");
    expect(screen.getByPlaceholderText("Last name")).toHaveValue("Kovalenko");
  });

  it("puts a single typed word into the first name", () => {
    render(<ClientPicker hidden={false} contact={null} onResolved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Bogdan" } });
    expect(screen.getByPlaceholderText("First name")).toHaveValue("Bogdan");
    expect(screen.getByPlaceholderText("Last name")).toHaveValue("");
  });

  it("lets the prefilled name be overridden", () => {
    render(<ClientPicker hidden={false} contact={null} onResolved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Olena K" } });
    fireEvent.change(screen.getByPlaceholderText("First name"), { target: { value: "Helena" } });
    expect(screen.getByPlaceholderText("First name")).toHaveValue("Helena");
  });

  it("does not shove a phone or an email into the name fields", () => {
    render(<ClientPicker hidden={false} contact={null} onResolved={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "someone@nowhere.io" } });
    expect(screen.getByPlaceholderText("First name")).toHaveValue("");
    expect(screen.getByPlaceholderText("Last name")).toHaveValue("");
  });

  it("offers a company picker in the new-client block and carries the pick into the draft", () => {
    const onDraft = vi.fn();
    render(<ClientPicker hidden={false} contact={null} onResolved={vi.fn()} onDraft={onDraft} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Olena Kovalenko" } });
    fireEvent.click(screen.getByLabelText("Company"));
    fireEvent.click(screen.getByRole("button", { name: "pick existing" }));

    expect(onDraft).toHaveBeenCalledWith(expect.objectContaining({ companyId: "co-1" }));
  });

  it("creates a new company from the block and assigns it to the draft", () => {
    createCompanyMutate.mockImplementation(
      (_body: unknown, opts?: { onSuccess?: (c: { id: string; title: string }) => void }) =>
        opts?.onSuccess?.({ id: "co-new", title: "Globex" }),
    );
    const onDraft = vi.fn();
    render(<ClientPicker hidden={false} contact={null} onResolved={vi.fn()} onDraft={onDraft} />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "Olena Kovalenko" } });
    fireEvent.click(screen.getByLabelText("Company"));
    fireEvent.click(screen.getByRole("button", { name: "create company" }));

    expect(createCompanyMutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Globex" }),
      expect.anything(),
    );
    expect(onDraft).toHaveBeenCalledWith(expect.objectContaining({ companyId: "co-new" }));
  });
});

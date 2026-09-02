import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClientType, CrmStatus } from "@bitcrm/types";
import type { Company } from "@bitcrm/types";
import { CompanyPickerDialog } from "./company-picker-dialog";

const companies: Company[] = [
  {
    id: "co-1",
    title: "Acme Storage",
    phones: [],
    emails: [],
    clientType: ClientType.COMMERCIAL,
    status: CrmStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
  },
];

describe("CompanyPickerDialog", () => {
  const onSelect = vi.fn();
  const onCreate = vi.fn();
  beforeEach(() => {
    onSelect.mockReset();
    onCreate.mockReset();
  });

  it("selects an existing company", () => {
    render(
      <CompanyPickerDialog open onOpenChange={() => {}} companies={companies} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText("Acme Storage"));
    expect(onSelect).toHaveBeenCalledWith("co-1");
  });

  it("offers to create a company from the typed name when onCreate is given", () => {
    render(
      <CompanyPickerDialog
        open
        onOpenChange={() => {}}
        companies={companies}
        onSelect={onSelect}
        onCreate={onCreate}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/search companies/i), {
      target: { value: "Globex" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create .*Globex/i }));
    expect(onCreate).toHaveBeenCalledWith("Globex");
  });

  it("has no create affordance without onCreate", () => {
    render(
      <CompanyPickerDialog open onOpenChange={() => {}} companies={companies} onSelect={onSelect} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/search companies/i), {
      target: { value: "Globex" },
    });
    expect(screen.queryByRole("button", { name: /create/i })).not.toBeInTheDocument();
  });
});

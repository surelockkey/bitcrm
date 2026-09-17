import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { BusinessProfileSelect } from "./business-profile-select";

const ok = (data: unknown) => HttpResponse.json({ success: true, data });
const base = { defaultPaymentTerms: "cash", dueDateBasis: "invoice_created" };

beforeEach(() => {
  server.use(
    http.get("*/billing/business-profiles", () =>
      ok([
        { ...base, id: "bp-default", name: "SureLock", isDefault: true, active: true },
        { ...base, id: "bp-2", name: "KeyPro", isDefault: false, active: true },
        { ...base, id: "bp-3", name: "Old Brand", isDefault: false, active: false },
      ]),
    ),
  );
});

describe("BusinessProfileSelect", () => {
  it("offers active companies only, with a default hint", async () => {
    const user = userEvent.setup();
    renderWithClient(<BusinessProfileSelect value="bp-2" onChange={() => {}} showDefaultHint aria-label="Company" />);
    const trigger = screen.getByRole("combobox", { name: "Company" });
    await vi.waitFor(() => expect(trigger).toHaveTextContent("KeyPro"));
    await user.click(trigger);
    expect(await screen.findByRole("option", { name: "SureLock (default company)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Old Brand/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /No company/ })).not.toBeInTheDocument();
  });

  it("keeps an archived selection visible", async () => {
    renderWithClient(<BusinessProfileSelect value="bp-3" onChange={() => {}} aria-label="Company" />);
    await vi.waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Company" })).toHaveTextContent("Old Brand (archived)"),
    );
  });

  it("shows a snapshot name for an unknown id", async () => {
    renderWithClient(
      <BusinessProfileSelect value="bp-gone" fallbackName="Gone Inc" onChange={() => {}} aria-label="Company" />,
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Company" })).toHaveTextContent("Gone Inc (archived)"),
    );
  });

  it("clears to null through the none option when allowed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithClient(
      <BusinessProfileSelect value="bp-2" onChange={onChange} allowNone noneLabel="No company" aria-label="Company" />,
    );
    await vi.waitFor(() => expect(screen.getByRole("combobox", { name: "Company" })).toHaveTextContent("KeyPro"));
    await user.click(screen.getByRole("combobox", { name: "Company" }));
    await user.click(await screen.findByRole("option", { name: "No company" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

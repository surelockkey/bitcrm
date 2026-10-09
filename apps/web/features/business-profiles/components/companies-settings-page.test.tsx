import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { BusinessProfileView } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { queryKeys } from "@/lib/query-keys";
import { CompaniesSettingsPage } from "./companies-settings-page";

let canEdit = true;
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (_r: string, action = "view") => action === "view" || canEdit,
    me: { id: "me" },
    isLoading: false,
    isTechnician: false,
  }),
}));

// Places autocomplete needs Google; a plain input is enough here.
vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Street" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

beforeAll(() => {
  URL.createObjectURL = () => "blob:local-logo";
  URL.revokeObjectURL = () => {};
});

const ok = (data: unknown) => HttpResponse.json({ success: true, data });

const base = {
  defaultPaymentTerms: "cash",
  dueDateBasis: "invoice_created",
} as const;

let companies: BusinessProfileView[];
const calls: { method: string; path: string; body?: unknown }[] = [];
let listVersion = 0;

beforeEach(() => {
  canEdit = true;
  calls.length = 0;
  listVersion = 0;
  companies = [
    {
      ...base,
      id: "bp-default",
      name: "SureLock",
      isDefault: true,
      active: true,
      phone: "8605550142",
      email: "office@surelock.com",
      logoAssetId: "logo-1",
      logoUrl: "https://s3/logo-1.png",
    } as BusinessProfileView,
    { ...base, id: "bp-2", name: "KeyPro", isDefault: false, active: true } as BusinessProfileView,
    { ...base, id: "bp-3", name: "Old Brand", isDefault: false, active: false } as BusinessProfileView,
  ];
  server.use(
    http.get("*/billing/business-profiles", () => {
      listVersion += 1;
      // A fresh array of fresh objects every time, like a real refetch.
      return ok(companies.map((c) => ({ ...c })));
    }),
    http.post("*/billing/business-profiles", async ({ request }) => {
      const body = (await request.json()) as object;
      calls.push({ method: "POST", path: "create", body });
      return ok({ ...base, id: "bp-new", isDefault: false, ...body });
    }),
    http.put("*/billing/business-profiles/:id", async ({ request, params }) => {
      const body = (await request.json()) as object;
      calls.push({ method: "PUT", path: String(params.id), body });
      const cur = companies.find((c) => c.id === params.id)!;
      return ok({ ...cur, ...body });
    }),
    http.post("*/billing/business-profiles/:id/default", ({ params }) => {
      calls.push({ method: "POST", path: `default/${params.id}` });
      return ok({ ...companies.find((c) => c.id === params.id)!, isDefault: true });
    }),
    http.delete("*/billing/business-profiles/:id", ({ params }) => {
      calls.push({ method: "DELETE", path: String(params.id) });
      return HttpResponse.json(
        { success: false, error: { code: "CONFLICT", message: "Template “Commercial” auto-applies to this company" } },
        { status: 409 },
      );
    }),
    http.post("*/billing/assets", () =>
      ok({ id: "logo-new", uploadUrl: "https://s3.example.com/put", headers: { "Content-Type": "image/png" } }),
    ),
    http.put("https://s3.example.com/put", () => new HttpResponse(null, { status: 200 })),
  );
});

const png = () => new File(["png"], "logo.png", { type: "image/png" });

/** The form's footer pill — the corner × is named "Close" too. */
const footerButton = (dialog: HTMLElement, name: string) =>
  within(dialog)
    .getAllByRole("button", { name })
    .find((b) => b.dataset.slot === "wz-button")!;

describe("CompaniesSettingsPage — a Workiz settings catalog", () => {
  it("lists the active companies under Workiz's columns: logo, phone, email, Default, Status", async () => {
    renderWithClient(<CompaniesSettingsPage />);
    const table = await screen.findByRole("table", { name: "Companies" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Company Name",
      "Logo",
      "Phone",
      "Email",
      "Default",
      "Status",
      "Actions",
    ]);
    const row = within(table).getByText("SureLock").closest("tr")!;
    expect(within(row).getByText("Default")).toBeInTheDocument();
    expect(within(row).getByRole("img", { name: "SureLock logo" })).toHaveAttribute("src", "https://s3/logo-1.png");
    expect(within(row).getByText("office@surelock.com")).toBeInTheDocument();
    expect(within(row).getByRole("switch", { name: "SureLock status" })).toBeChecked();
    // Archived companies wait behind "Show: Disabled / All", as Workiz's do.
    expect(within(table).queryByText("Old Brand")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Show" }));
    await userEvent.click(await screen.findByRole("option", { name: "All" }));
    expect(within(table).getByRole("switch", { name: "Old Brand status" })).not.toBeChecked();
  });

  it("adds a company", async () => {
    const user = userEvent.setup();
    renderWithClient(<CompaniesSettingsPage />);
    await user.click(await screen.findByRole("button", { name: "Add New Company" }));
    const dialog = await screen.findByRole("dialog", { name: "Add New Company" });
    await user.type(within(dialog).getByLabelText("Company Name"), "Lock Masters");
    await user.type(within(dialog).getByLabelText("Company Phone"), "2035550100");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        path: "create",
        body: {
          name: "Lock Masters",
          phone: "2035550100",
          active: true,
          defaultPaymentTerms: "cash",
          dueDateBasis: "invoice_created",
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("removing a logo sends logoAssetId: null", async () => {
    const user = userEvent.setup();
    renderWithClient(<CompaniesSettingsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit SureLock" }));
    const dialog = await screen.findByRole("dialog", { name: "SureLock" });
    expect(within(dialog).getByRole("img", { name: "Company logo" })).toHaveAttribute("src", "https://s3/logo-1.png");
    await user.click(within(dialog).getByRole("button", { name: "Remove logo" }));
    expect(within(dialog).queryByRole("img", { name: "Company logo" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ logoAssetId: null }));
  });

  it("keeps a freshly uploaded logo when the list refetches, and saves it", async () => {
    const user = userEvent.setup();
    const { client } = renderWithClient(<CompaniesSettingsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit KeyPro" }));
    const dialog = await screen.findByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Upload logo"), png());
    await waitFor(() =>
      expect(within(dialog).getByRole("img", { name: "Company logo" })).toHaveAttribute("src", "blob:local-logo"),
    );
    const before = listVersion;
    await client.invalidateQueries({ queryKey: queryKeys.businessProfiles.all() });
    await waitFor(() => expect(listVersion).toBeGreaterThan(before));
    expect(within(dialog).getByRole("img", { name: "Company logo" })).toHaveAttribute("src", "blob:local-logo");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT" && c.path === "bp-2")?.body).toMatchObject({ logoAssetId: "logo-new" }),
    );
  });

  it("explains a failed storage upload and keeps the previous logo", async () => {
    server.use(http.put("https://s3.example.com/put", () => HttpResponse.error()));
    const user = userEvent.setup();
    renderWithClient(<CompaniesSettingsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit SureLock" }));
    const dialog = await screen.findByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Upload logo"), png());
    expect(await within(dialog).findByText(/Upload blocked — storage CORS\/network/)).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: "Company logo" })).toHaveAttribute("src", "https://s3/logo-1.png");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ logoAssetId: "logo-1" }));
  });

  it("makes a company the default and switches one off and on from its row", async () => {
    const user = userEvent.setup();
    renderWithClient(<CompaniesSettingsPage />);
    await user.click(await screen.findByRole("button", { name: "Make KeyPro the default" }));
    await waitFor(() => expect(calls).toContainEqual({ method: "POST", path: "default/bp-2" }));

    await user.click(screen.getByRole("switch", { name: "KeyPro status" }));
    await waitFor(() => expect(calls).toContainEqual({ method: "PUT", path: "bp-2", body: { active: false } }));
    // The switch is the switch's alone: the row did not open.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Show" }));
    await user.click(await screen.findByRole("option", { name: "All" }));
    await user.click(screen.getByRole("switch", { name: "Old Brand status" }));
    await waitFor(() => expect(calls).toContainEqual({ method: "PUT", path: "bp-3", body: { active: true } }));
  });

  it("the default company can't be switched off or deleted", async () => {
    renderWithClient(<CompaniesSettingsPage />);
    expect(await screen.findByRole("button", { name: "Delete SureLock" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "SureLock status" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Make SureLock the default" })).not.toBeInTheDocument();
  });

  it("shows the server's reason when delete is refused", async () => {
    const user = userEvent.setup();
    renderWithClient(<CompaniesSettingsPage />);
    await user.click(await screen.findByRole("button", { name: "Delete KeyPro" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Delete company" }));
    expect(await within(confirm).findByText(/auto-applies to this company/)).toBeInTheDocument();
    expect(calls).toContainEqual({ method: "DELETE", path: "bp-2" });
  });

  it("is read-only without settings edit", async () => {
    canEdit = false;
    const user = userEvent.setup();
    renderWithClient(<CompaniesSettingsPage />);
    await screen.findByRole("table", { name: "Companies" });
    expect(screen.queryByRole("button", { name: "Add New Company" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete KeyPro" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make KeyPro the default" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "KeyPro status" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "View SureLock" }));
    const dialog = await screen.findByRole("dialog", { name: "SureLock" });
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Company Name")).toBeDisabled();
    await user.click(footerButton(dialog, "Close"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

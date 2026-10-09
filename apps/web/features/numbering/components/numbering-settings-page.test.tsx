import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ perms: new Set(["settings.view", "settings.edit"]) }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string, a = "view") => mocks.perms.has(`${r}.${a}`), isLoading: false }),
  useDenied: () => (r: string, a = "view") => !mocks.perms.has(`${r}.${a}`),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { NumberingSettingsPage } from "./numbering-settings-page";

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
let put: Record<string, unknown> | undefined;

function numbering(over: { refuse?: { status: number; message: string } } = {}) {
  server.use(
    http.get("*/billing/numbering", () =>
      HttpResponse.json({ success: true, data: { nextInvoiceNumber: 85427, nextEstimateNumber: 1142 } }),
    ),
    http.put("*/billing/numbering", async ({ request }) => {
      put = (await request.json()) as Record<string, unknown>;
      if (over.refuse) {
        return HttpResponse.json(
          { success: false, error: { code: "BAD_REQUEST", message: over.refuse.message } },
          { status: over.refuse.status },
        );
      }
      return HttpResponse.json({ success: true, data: { nextInvoiceNumber: 85427, nextEstimateNumber: 1142, ...put } });
    }),
  );
}

beforeEach(() => {
  put = undefined;
  mocks.perms = new Set(["settings.view", "settings.edit"]);
  toast.success.mockClear();
  numbering();
});

/**
 * Settings → Numbering, Workiz's page (`/root/numbering`): the band, "Job
 * Ids" (ours are coded, as the account's), the Next Invoice Id / Next
 * Estimate Id boxes, Workiz's note under them, Save.
 */
describe("NumberingSettingsPage", () => {
  it("refuses anyone without settings.view", () => {
    mocks.perms = new Set([]);
    renderWithClient(<NumberingSettingsPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("shows Workiz's words: the band, coded job ids, the two boxes with the next numbers, the note", async () => {
    renderWithClient(<NumberingSettingsPage />);
    expect(await screen.findByLabelText("Next Invoice Id")).toHaveValue("85427");
    expect(screen.getByLabelText("Next Estimate Id")).toHaveValue("1142");
    expect(screen.getByRole("heading", { name: "Numbering" })).toBeInTheDocument();
    expect(screen.getByText(/Set the serial numbers for your next invoice\/estimate\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job Ids" })).toBeInTheDocument();
    expect(screen.getByText("Use Coded")).toBeInTheDocument();
    expect(screen.getByText("Job ids will be coded and not serial")).toBeInTheDocument();
    expect(screen.getByText("Example: XH5F7A")).toBeInTheDocument();
    expect(screen.getByText("*Invoice/ Estimate numbers must be more than the last number")).toBeInTheDocument();
    // No Next Lead Id: there is no Leads module.
    expect(screen.queryByLabelText(/lead/i)).toBeNull();
  });

  it("saves both next numbers as whole numbers", async () => {
    const u = user();
    renderWithClient(<NumberingSettingsPage />);
    const invoice = await screen.findByLabelText("Next Invoice Id");
    await u.clear(invoice);
    await u.type(invoice, "85700");
    await u.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(put).toEqual({ nextInvoiceNumber: 85700, nextEstimateNumber: 1142 }));
    expect(toast.success).toHaveBeenCalledWith("Numbering saved");
  });

  it("keeps nonsense from leaving the page", async () => {
    const u = user();
    renderWithClient(<NumberingSettingsPage />);
    const estimate = await screen.findByLabelText("Next Estimate Id");
    await u.clear(estimate);
    await u.type(estimate, "12.5");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a whole number")).toBeInTheDocument();
    expect(put).toBeUndefined();
  });

  it("puts the server's refusal under the box it names", async () => {
    numbering({ refuse: { status: 400, message: "Next Invoice Id must be more than the last number (85426)" } });
    const u = user();
    renderWithClient(<NumberingSettingsPage />);
    const invoice = await screen.findByLabelText("Next Invoice Id");
    await u.clear(invoice);
    await u.type(invoice, "5");
    await u.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Next Invoice Id must be more than the last number (85426)")).toBeInTheDocument();
    expect(invoice).toHaveAttribute("aria-invalid", "true");
  });

  it("is read-only without settings.edit", async () => {
    mocks.perms = new Set(["settings.view"]);
    renderWithClient(<NumberingSettingsPage />);
    expect(await screen.findByLabelText("Next Invoice Id")).toBeDisabled();
    expect(screen.getByLabelText("Next Estimate Id")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { ClientType, CrmStatus } from "@bitcrm/types";
import type { Company } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeServer,
} from "@/test/page-load";

/**
 * The companies list does not fill in while you watch.
 *
 * The toolbar said "0 companies" until the rows came and then "284
 * companies" — the number grew leftwards under the reader's eye — and the
 * "New company" button turned up on its own beat. Now the rows, the cards'
 * numbers, the footer and "+ Add Company" come in one frame.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/companies",
  useSearchParams: () => new URLSearchParams(),
}));

const perms = vi.hoisted(() => ({ loading: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: perms.loading, me: { id: "u1" } }),
}));

const company = (id: string, title: string): Company => ({
  id,
  title,
  phones: [],
  emails: [],
  clientType: ClientType.COMMERCIAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
});

let server: FakeServer;

const { CompaniesPage } = await import("./companies-page");

const text = () => document.body.textContent ?? "";
const rowsUp = () => !!screen.queryByText("Acme Storage");

beforeEach(() => {
  perms.loading = false;
  server = installFakeServer([
    {
      match: /\/crm\/companies$/,
      raw: true,
      reply: (url) =>
        url.searchParams.get("cursor")
          ? { success: true, data: [company("co3", "Gamma Works")], pagination: { count: 1 } }
          : { success: true, data: [company("co1", "Acme Storage"), company("co2", "Beta Holdings")], pagination: { count: 2, nextCursor: "cur-2" } },
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CompaniesPage — no jumping", () => {
  it("draws the rows, their number and the button in one frame", async () => {
    const watch = watchFirstFrame(rowsUp, () => ({
      count: screen.queryByRole("button", { name: "Companies" })?.textContent?.includes("3") ?? false,
      footer: text().includes("Showing 1 to 3 of 3 results"),
      newCompany: !!screen.queryByRole("button", { name: "Add Company" }),
      skeletons: skeletonCount(),
    }));
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Acme Storage", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ count: true, footer: true, newCompany: true, skeletons: 0 });
  });

  it("never says '0' companies while the rows are on their way", async () => {
    let zero = false;
    const observer = new MutationObserver(() => {
      if (text().includes("of 0 results") || screen.queryByText("No Records Found")) zero = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Acme Storage", {}, { timeout: 3000 });
    observer.disconnect();

    expect(zero).toBe(false);
  });

  it("puts nothing up — not even the button — until the permissions are in", async () => {
    perms.loading = true;
    renderWithClient(<CompaniesPage />);
    await settle(100);

    expect(screen.queryByRole("button", { name: "Add Company" })).toBeNull();
    expect(screen.queryByText("Acme Storage")).toBeNull();
  });

  it("asks for each thing once", async () => {
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Acme Storage", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientType, CrmStatus, type Company } from "@bitcrm/types";
import { installFakeServer, renderWithClient } from "@/test/page-load";

/**
 * The Companies list drawn as Workiz's Clients list (BitCRM-only page; the
 * closest Workiz pattern is `/root/clients/`): the cards are the filter,
 * Filter results narrows by type and platinum, Search narrows at once, ten a
 * page with Workiz's pager, the row opens the company, "+ Add Company" opens
 * the new-company form — only for someone who may create one.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/companies",
  useSearchParams: () => new URLSearchParams(),
}));
const grants = new Set<string>();
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: (r: string, a: string) => grants.has(`${r}.${a}`), isLoading: false, me: { id: "u1" } }),
}));

const company = (id: string, title: string, over: Partial<Company> = {}): Company => ({
  id,
  title,
  phones: [],
  emails: [],
  clientType: ClientType.COMMERCIAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  // Newer ids are newer: c12 is the newest.
  createdAt: `2026-10-${String(Number(id.slice(1))).padStart(2, "0")}T12:00:00.000Z`,
  updatedAt: "",
  ...over,
});

const companies = [
  ...Array.from({ length: 10 }, (_, i) => company(`c${i + 1}`, `Firm ${String(i + 1).padStart(2, "0")}`)),
  company("c11", "City of Mesa", { clientType: ClientType.GOVERNMENT }),
  company("c12", "Grata Smart Living", { isPlatinum: true, emails: ["amali@grata.life"] }),
];

const { CompaniesPage } = await import("./companies-page");
const { useCompanyFieldsStore } = await import("../companies-fields-store");

beforeEach(() => {
  grants.clear();
  ["companies.view", "companies.create"].forEach((g) => grants.add(g));
  useCompanyFieldsStore.setState({ used: ["name", "type", "address", "phone", "created"] });
  try {
    localStorage.clear();
  } catch {
    /* no storage in this run */
  }
  push.mockClear();
  installFakeServer([{ match: /\/crm\/companies$/, raw: true, reply: () => ({ success: true, data: companies, pagination: { count: companies.length } }) }]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rowTitles = () =>
  within(screen.getByRole("table", { name: "Companies" }))
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td div")?.textContent ?? "")
    .filter(Boolean);

describe("CompaniesPage — Workiz's Clients list, for companies", () => {
  it("shows the cards' counts and the newest ten first, with Workiz's footer", async () => {
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Grata Smart Living", {}, { timeout: 3000 });

    expect(screen.getByRole("button", { name: "Companies" })).toHaveTextContent("12");
    expect(screen.getByRole("button", { name: "Government" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Platinum" })).toHaveTextContent("1");
    expect(rowTitles().slice(0, 2)).toEqual(["Grata Smart Living", "City of Mesa"]);
    expect(rowTitles()).toHaveLength(10);
    expect(screen.getByText("Showing 1 to 10 of 12 results")).toBeInTheDocument();
  });

  it("a card is the filter: Government narrows the list, Companies clears it", async () => {
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Grata Smart Living", {}, { timeout: 3000 });

    await userEvent.click(screen.getByRole("button", { name: "Government" }));
    expect(rowTitles()).toEqual(["City of Mesa"]);
    expect(screen.getByRole("button", { name: "Government" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("type: Government")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Companies" }));
    expect(rowTitles()).toHaveLength(10);
    expect(screen.queryByText("type: Government")).toBeNull();
    // Nothing filtered, nothing chosen: no card turns orange.
    for (const name of ["Companies", "Commercial", "Government", "Platinum"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("Filter results narrows to platinum accounts", async () => {
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Grata Smart Living", {}, { timeout: 3000 });

    await userEvent.click(screen.getByRole("combobox", { name: "Filter results" }));
    await userEvent.click(within(screen.getByRole("listbox", { name: "Platinum" })).getByRole("option", { name: "Yes" }));

    expect(rowTitles()).toEqual(["Grata Smart Living"]);
    expect(screen.getByRole("button", { name: "Platinum" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Search narrows as you type and goes back to page 1", async () => {
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Grata Smart Living", {}, { timeout: 3000 });

    await userEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(screen.getByText("Showing 11 to 12 of 12 results")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "grata");
    expect(rowTitles()).toEqual(["Grata Smart Living"]);
    expect(screen.getByText("Showing 1 to 1 of 1 results")).toBeInTheDocument();
  });

  it("No Records Found when nothing matches", async () => {
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Grata Smart Living", {}, { timeout: 3000 });
    await userEvent.type(screen.getByRole("searchbox"), "zzzz");
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
  });

  it("the Name header sorts A→Z, then Z→A", async () => {
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Grata Smart Living", {}, { timeout: 3000 });

    await userEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(rowTitles()[0]).toBe("City of Mesa");
    await userEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(rowTitles()[0]).toBe("Grata Smart Living");
  });

  it("the row opens the company", async () => {
    renderWithClient(<CompaniesPage />);
    await userEvent.click(await screen.findByText("City of Mesa", {}, { timeout: 3000 }));
    expect(push).toHaveBeenCalledWith("/companies/c11");
  });

  it("+ Add Company opens the new-company form; without companies.create there is no button", async () => {
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Grata Smart Living", {}, { timeout: 3000 });
    await userEvent.click(screen.getByRole("button", { name: "Add Company" }));
    expect(await screen.findByRole("dialog", { name: "Add Company" })).toBeInTheDocument();
    cleanup();

    grants.delete("companies.create");
    renderWithClient(<CompaniesPage />);
    await screen.findByText("Grata Smart Living", {}, { timeout: 3000 });
    expect(screen.queryByRole("button", { name: "Add Company" })).toBeNull();
  });
});

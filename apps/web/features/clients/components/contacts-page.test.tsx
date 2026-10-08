import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactSource, ContactType, CrmStatus, type Contact } from "@bitcrm/types";
import { installFakeServer, renderWithClient, type FakeServer } from "@/test/page-load";

/**
 * The Clients list's behaviour, as Workiz's (pg_contacts_wz_*): Filter
 * results → TAGS narrows on the server, the row opens the client, "+ Add
 * Client" opens the new-client form, a viewer without the money does not
 * get its cards.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/contacts",
  useSearchParams: () => new URLSearchParams(),
}));
const grants = new Set<string>();
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: (r: string, a: string) => grants.has(`${r}.${a}`), isLoading: false, me: { id: "u1" } }),
}));

const person = (id: string, firstName: string, tagIds: string[] = []): Contact => ({
  id,
  firstName,
  lastName: "Doe",
  phones: [],
  emails: [],
  addresses: [],
  tagIds,
  type: ContactType.RESIDENTIAL,
  source: ContactSource.MANUAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "2026-10-08T20:26:00.000Z",
  updatedAt: "",
});

let server: FakeServer;
const { ContactsPage } = await import("./contacts-page");
const { useClientFieldsStore } = await import("../clients-fields-store");

beforeEach(() => {
  grants.clear();
  ["contacts.view", "contacts.create", "invoices.view", "estimates.view"].forEach((g) => grants.add(g));
  useClientFieldsStore.setState({ used: ["name", "address", "phone", "created"] });
  push.mockClear();
  server = installFakeServer([
    {
      match: /\/crm\/contacts$/,
      raw: true,
      // An older server ignores `tagIds` and sends every row.
      reply: () => ({ success: true, data: [person("c1", "Ann", ["t-plat"]), person("c2", "Bob")], pagination: { count: 2 } }),
    },
    { match: /\/crm\/contacts\/count$/, reply: () => ({ total: 2, atLeast: false }) },
    { match: /\/deals\/client-tags$/, reply: () => [{ id: "t-plat", name: "PLATINUM", color: "blue", priority: 1, active: true }] },
    { match: /\/deals\/job-sources$/, reply: () => [] },
    { match: /\/billing\/invoices\/summary$/, reply: () => ({ dueAmount: 10, overdueAmount: 5 }) },
    { match: /\/billing\/estimates\/summary$/, reply: () => ({ pending: { count: 1, amount: 9 } }) },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ContactsPage — Workiz's Clients list", () => {
  it("narrows the list to a picked tag: asks the server for it, and keeps only the rows that carry it", async () => {
    renderWithClient(<ContactsPage />);
    await screen.findByText("Bob Doe", {}, { timeout: 3000 });

    await userEvent.click(screen.getByRole("combobox", { name: "Filter results" }));
    await userEvent.click(within(screen.getByRole("listbox", { name: "Tags" })).getByRole("option", { name: "PLATINUM" }));

    expect(await screen.findByText("tag: PLATINUM")).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByText("Bob Doe")).toBeNull(), { timeout: 3000 });
    expect(screen.getByText("Ann Doe")).toBeInTheDocument();
    expect(server.requests.some((r) => r.includes("/crm/contacts?") && r.includes("tagIds=t-plat"))).toBe(true);
    expect(server.requests.some((r) => r.includes("/crm/contacts/count?") && r.includes("tagIds=t-plat"))).toBe(true);
  });

  it("opens the client from its row", async () => {
    renderWithClient(<ContactsPage />);
    fireEvent.click(await screen.findByText("Ann Doe", {}, { timeout: 3000 }));
    expect(push).toHaveBeenCalledWith("/contacts/c1");
  });

  it("'+ Add Client' opens the new-client form", async () => {
    renderWithClient(<ContactsPage />);
    await screen.findByText("Ann Doe", {}, { timeout: 3000 });
    await userEvent.click(screen.getByRole("button", { name: /add client/i }));
    expect(screen.getByRole("dialog", { name: "Add Client" })).toBeInTheDocument();
  });

  it("leaves the money cards out for a viewer without invoices or estimates", async () => {
    grants.delete("invoices.view");
    grants.delete("estimates.view");
    renderWithClient(<ContactsPage />);
    await screen.findByText("Ann Doe", {}, { timeout: 3000 });
    expect(screen.getByRole("group", { name: "Clients" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Due" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Estimates Pending" })).toBeNull();
    expect(server.requests.some((r) => r.includes("/billing/"))).toBe(false);
  });

  it("has no Add Client for a viewer who cannot create", async () => {
    grants.delete("contacts.create");
    renderWithClient(<ContactsPage />);
    await screen.findByText("Ann Doe", {}, { timeout: 3000 });
    expect(screen.queryByRole("button", { name: /add client/i })).toBeNull();
  });
});

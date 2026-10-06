import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueryClient } from "@tanstack/react-query";
import { ClientType, ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Company, Contact } from "@bitcrm/types";
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
 * The company page appears once, whole.
 *
 * It went up with the company and then grew: "Contacts · 0" turned into the
 * real number, and the Text / Edit / Delete buttons and the Estimates /
 * Invoices / Messages tabs came when the permissions did — squeezing the
 * badges in the header across. Opening the Contacts tab then showed the
 * people's ad sources as raw ids, and a moment later as names.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/companies/co1",
  useSearchParams: () => new URLSearchParams(),
}));

const company: Company = {
  id: "co1",
  title: "Acme Storage",
  phones: ["+14045550100"],
  emails: ["office@example.com"],
  address: "1 Main St, Marietta, GA",
  clientType: ClientType.COMMERCIAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const person = (id: string, firstName: string, lastName: string): Contact => ({
  id,
  firstName,
  lastName,
  phones: [],
  emails: [],
  addresses: [],
  companyId: "co1",
  type: ContactType.COMPANY_REPRESENTATIVE,
  source: ContactSource.MANUAL,
  sourceId: "src-1",
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
});

let server: FakeServer;
let client: QueryClient;

const { CompanyDetailPage } = await import("./company-detail-page");

const pageUp = () => !!screen.queryByText("Acme Storage");
const tab = (name: RegExp) => screen.queryByRole("tab", { name });

function renderPage() {
  ({ client } = renderWithClient(<CompanyDetailPage companyId="co1" />));
}

beforeEach(() => {
  server = installFakeServer([
    // The order the browser sees: the company, its people, then the permissions.
    { match: /\/crm\/companies\/co1$/, reply: () => company },
    {
      match: /\/crm\/companies\/co1\/contacts$/,
      raw: true,
      reply: () => ({ success: true, data: [person("c1", "Jane", "Smith"), person("c2", "Bob", "Jones")], pagination: { count: 2 } }),
      delayMs: 60,
    },
    { match: /\/users\/me$/, reply: () => ({ id: "u1", firstName: "Dee", lastName: "Spatch", email: "dee@example.com", roleId: "role-super-admin" }), delayMs: 90 },
    { match: /\/deals\/job-sources$/, reply: () => [{ id: "src-1", name: "Google Ads", priority: 1, active: true }], delayMs: 120 },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CompanyDetailPage — one load, not waves", () => {
  it("shows the company with its people's number, its buttons and its tabs in one frame", async () => {
    const watch = watchFirstFrame(pageUp, () => ({
      contactsTab: tab(/^Contacts/)?.textContent ?? null,
      estimatesTab: !!tab(/^Estimates/),
      edit: !!screen.queryByRole("button", { name: /^edit$/i }),
      skeletons: skeletonCount(),
    }));
    renderPage();
    await screen.findByText("Acme Storage", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ contactsTab: "Contacts · 2", estimatesTab: true, edit: true, skeletons: 0 });
  });

  it("the Contacts tab opens with the people's ad sources by name, and asks for nothing", async () => {
    renderPage();
    await screen.findByText("Acme Storage", {}, { timeout: 3000 });
    await settle();
    const asked = server.requests.length;

    await userEvent.click(tab(/^Contacts/)!);
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getAllByText("Google Ads")).toHaveLength(2);
    await settle();
    expect(server.requests.slice(asked)).toEqual([]);
  });

  it("asks for each thing once", async () => {
    renderPage();
    await screen.findByText("Acme Storage", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });

  it("once shown, a refetch never takes the page back to the skeleton", async () => {
    renderPage();
    await screen.findByText("Acme Storage", {}, { timeout: 3000 });

    let lost = false;
    const observer = new MutationObserver(() => {
      if (!pageUp()) lost = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await client.invalidateQueries();
    await settle();
    observer.disconnect();

    expect(lost).toBe(false);
  });
});

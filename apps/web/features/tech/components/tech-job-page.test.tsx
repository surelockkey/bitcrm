import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { installFakeServer, renderWithClient, type FakeServer } from "@/test/page-load";
import { techJobRoutes } from "./tech-job-page.fixtures";

/**
 * `/my-jobs/:id` is Workiz's job page (job_b_01_details) — the one a Workiz
 * technician opens too: the grey band with "Job #… - Client", Job name /
 * Status / Tags and the job tab bar, the Details form, the right rail. Ours
 * on top of it: the visit's steps as one more row of the band.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/my-jobs/d1",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** What the technician may do — the seeded Technician role; a test narrows it. */
let granted = (resource: string, action = "view") =>
  !(resource === "deals" && (action === "create" || action === "delete")) && resource !== "users" && resource !== "settings";
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action?: string) => !granted(resource, action),
  usePermissions: () => ({
    can: (resource: string, action?: string) => granted(resource, action),
    isTechnician: true,
    isLoading: false,
    me: { id: "t1", firstName: "Tess", lastName: "Tech" },
  }),
}));
vi.mock("@/features/calls/components/live-call-strip", () => ({ LiveCallStrip: () => null }));

let server: FakeServer;

const { TechJobPage } = await import("./tech-job-page");

beforeEach(() => {
  granted = (resource: string, action = "view") =>
    !(resource === "deals" && (action === "create" || action === "delete")) && resource !== "users" && resource !== "settings";
  server = installFakeServer(techJobRoutes(), { delayMs: 5 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TechJobPage — the job page, with the visit", () => {
  it("refuses a viewer who may not see jobs", () => {
    granted = () => false;
    renderWithClient(<TechJobPage dealId="d1" />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("is Workiz's job page: the title, Status and Tags, the job tabs", async () => {
    renderWithClient(<TechJobPage dealId="d1" />);

    expect(await screen.findByRole("heading", { name: "Job #1042 - Jane Smith" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Status:")).toBeInTheDocument();
    expect(screen.getByText("Tags:")).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "Job sections" });
    expect(tabs).toHaveTextContent("Details");
    expect(tabs).toHaveTextContent("Attachments");
  });

  it("carries the visit as a row of the band — under Tags, over the tab bar", async () => {
    renderWithClient(<TechJobPage dealId="d1" />);
    const visit = await screen.findByRole("group", { name: "Visit" }, { timeout: 3000 });

    const tags = screen.getByText("Tags:");
    const tabBar = screen.getByRole("tablist", { name: "Job sections" });
    expect(tags.compareDocumentPosition(visit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(visit.compareDocumentPosition(tabBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Confirm receipt/ })).toBeInTheDocument();
  });

  it("marks the job seen when its technician opens it, as the job page does", async () => {
    renderWithClient(<TechJobPage dealId="d1" />);
    await screen.findByRole("heading", { name: "Job #1042 - Jane Smith" }, { timeout: 3000 });

    await vi.waitFor(() => expect(server.requests.some((r) => r.endsWith("/deals/d1/seen"))).toBe(true));
  });

  it("puts the photos where Workiz keeps them: Attachments → Upload", async () => {
    renderWithClient(<TechJobPage dealId="d1" />);
    await screen.findByRole("heading", { name: "Job #1042 - Jane Smith" }, { timeout: 3000 });
    fireEvent.click(screen.getByRole("tab", { name: "Attachments" }));

    // The yellow "Upload" pill (and, with nothing attached yet, "+ Upload files").
    expect(await screen.findByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  it("has no back link and no 'full job' detour — this is the full job", async () => {
    renderWithClient(<TechJobPage dealId="d1" />);
    await screen.findByRole("heading", { name: "Job #1042 - Jane Smith" }, { timeout: 3000 });

    expect(screen.queryByRole("link", { name: /my jobs/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /open the full job/i })).toBeNull();
  });

  it("says so, with a way back to the list, when the job is gone", async () => {
    server.fail(/\/deals\/d1$/);
    renderWithClient(<TechJobPage dealId="d1" />);

    expect(await screen.findByText("Job not found", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to my jobs/i })).toHaveAttribute("href", "/my-jobs");
  });
});

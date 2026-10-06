import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const perms = vi.hoisted(() => ({ isLoading: true }));
const nav = vi.hoisted(() => ({ pathname: "/settings/job-types" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => !perms.isLoading, isLoading: perms.isLoading }),
}));

const { SettingsSidebar } = await import("./settings-sidebar");

/**
 * The rail lists the sections the reader may open, and that answer lands a
 * beat after the page paints. Drawn meanwhile, it stood at "General" and then
 * grew to twenty links on every settings page; now it waits out of sight and
 * is drawn once, whole — the same treatment as the app's own sidebar.
 */
describe("SettingsSidebar", () => {
  it("stays out of sight while the permissions are on their way", () => {
    perms.isLoading = true;
    render(<SettingsSidebar />);
    expect(screen.getByRole("navigation").className).toMatch(/\binvisible\b/);
  });

  it("is drawn whole once they are in", () => {
    perms.isLoading = false;
    render(<SettingsSidebar />);
    const nav = screen.getByRole("navigation");
    expect(nav.className).not.toMatch(/\binvisible\b/);
    expect(screen.getAllByRole("link").length).toBeGreaterThan(5);
  });

  it("files its links under the same blocks as the settings page", () => {
    perms.isLoading = false;
    render(<SettingsSidebar />);
    expect(screen.getAllByRole("group")).toHaveLength(5);
    const job = screen.getByRole("group", { name: "Job Settings" });
    expect(within(job).getByText("Job Settings")).toBeInTheDocument();
    expect(within(job).getByRole("link", { name: /Job Types/ })).toHaveAttribute("href", "/settings/job-types");
    expect(within(job).queryByRole("link", { name: /Call Flows/ })).toBeNull();
  });

  it("opens with General, which is the settings screen itself", () => {
    perms.isLoading = false;
    nav.pathname = "/settings";
    render(<SettingsSidebar />);
    const general = screen.getByRole("link", { name: /General/ });
    expect(general).toHaveAttribute("href", "/settings");
    expect(general).toHaveAttribute("aria-current", "page");
    // It stands above the blocks, not inside one of them.
    expect(screen.getAllByRole("link")[0]).toBe(general);
    for (const group of screen.getAllByRole("group")) {
      expect(within(group).queryByRole("link", { name: /^General$/ })).toBeNull();
    }
  });

  it("lights the section being edited, and not General", () => {
    perms.isLoading = false;
    nav.pathname = "/settings/job-types";
    render(<SettingsSidebar />);
    expect(screen.getByRole("link", { name: /Job Types/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /General/ })).not.toHaveAttribute("aria-current");
  });
});

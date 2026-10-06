import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const perms = vi.hoisted(() => ({ isLoading: true }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings/general" }));
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
});

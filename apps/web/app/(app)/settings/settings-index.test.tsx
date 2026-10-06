import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const perms = vi.hoisted(() => ({ can: (() => true) as (resource: string) => boolean }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string) => perms.can(r), isLoading: false }),
}));

const { SettingsIndex } = await import("./settings-index");

/**
 * The settings landing page in Workiz's blocks: a heading per block, the
 * block's sections as tiles under it.
 */
describe("SettingsIndex", () => {
  it("draws a heading per block and the block's sections under it", () => {
    perms.can = () => true;
    render(<SettingsIndex />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["General Settings", "Users & Roles", "Job Settings", "Calls & Text", "Integrations"]);

    const calls = screen.getByRole("region", { name: "Calls & Text" });
    expect(within(calls).getByRole("link", { name: /Call Flows/ })).toHaveAttribute("href", "/settings/call-flows");
    expect(within(calls).queryByRole("link", { name: /Job Types/ })).toBeNull();

    const team = screen.getByRole("region", { name: "Users & Roles" });
    expect(within(team).getByRole("link", { name: /Users/ })).toHaveAttribute("href", "/admin/users");
    expect(within(team).getByRole("link", { name: /Roles/ })).toHaveAttribute("href", "/admin/roles");
  });

  it("leaves out a block the reader can open nothing in", () => {
    perms.can = (r) => r !== "users" && r !== "roles";
    render(<SettingsIndex />);
    expect(screen.queryByRole("heading", { name: "Users & Roles" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Job Settings" })).toBeInTheDocument();
  });
});

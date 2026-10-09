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
    // Workiz's Calls & Text tiles open its Phone section's tabs (/root/flows → /root/callsReport/flows).
    expect(within(calls).getByRole("link", { name: /Call Flows/ })).toHaveAttribute("href", "/calls/flows");
    expect(within(calls).queryByRole("link", { name: /Job Types/ })).toBeNull();

    // Workiz's tile words (app_audit_wz_settings): a Workiz user looks for
    // "Team Management" and "Roles & Permissions", not "Users" and "Roles".
    const team = screen.getByRole("region", { name: "Users & Roles" });
    expect(within(team).getByRole("link", { name: /^Team Management$/ })).toHaveAttribute("href", "/admin/users");
    expect(within(team).getByRole("link", { name: /^Roles & Permissions$/ })).toHaveAttribute("href", "/admin/roles");
    const jobs = screen.getByRole("region", { name: "Job Settings" });
    expect(within(jobs).getByRole("link", { name: /^Ad Groups$/ })).toHaveAttribute("href", "/settings/job-sources");
    expect(within(jobs).getByRole("link", { name: /^Field Validation$/ })).toHaveAttribute("href", "/settings/job-fields");
    expect(within(jobs).getByRole("link", { name: /^Sub-Status$/ })).toHaveAttribute("href", "/settings/job-statuses");
    const general = screen.getByRole("region", { name: "General Settings" });
    expect(within(general).getByRole("link", { name: /^Automation Center$/ })).toHaveAttribute("href", "/automations");
  });

  it("leaves out a block the reader can open nothing in", () => {
    perms.can = (r) => r !== "technicians" && r !== "users" && r !== "roles";
    render(<SettingsIndex />);
    expect(screen.queryByRole("heading", { name: "Users & Roles" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Job Settings" })).toBeInTheDocument();
  });
});

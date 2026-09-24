import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/render-with-client";
import { NavUser } from "./nav-user";

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    me: { firstName: "Dana", lastName: "Ruiz", email: "dana@example.com" },
    roleName: "Dispatcher",
    can: () => true,
  }),
}));

vi.mock("@/features/auth/hooks", () => ({ useLogout: () => vi.fn() }));

vi.mock("@/features/telephony/softphone-store", () => ({
  useSoftphoneStore: (select: (s: unknown) => unknown) =>
    select({ setDialerOpen: vi.fn() }),
}));

async function openMenu() {
  renderWithClient(<NavUser />);
  await userEvent.click(screen.getByRole("button", { name: /dana ruiz/i }));
}

describe("the user menu", () => {
  it("names the signed-in user", async () => {
    await openMenu();
    expect(await screen.findByText("dana@example.com")).toBeInTheDocument();
  });

  it("still offers profile, settings and sign out", async () => {
    await openMenu();
    expect(await screen.findByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("offers no theme switch while the app is light-only", async () => {
    // The Workiz palette pass ships light only, so a Dark item would add the
    // .dark class and fire 212 dark: utilities against light tokens.
    await openMenu();
    await screen.findByText("Sign out");
    expect(screen.queryByText("Theme")).not.toBeInTheDocument();
    expect(screen.queryByText("Dark")).not.toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });
});

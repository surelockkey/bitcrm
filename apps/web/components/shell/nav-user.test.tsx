import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/render-with-client";
import { NavUser } from "./nav-user";

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
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

  it("offers Workiz's On-screen notifications switch, which asks the browser and keeps the menu open", async () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    try {
      await openMenu();
      const item = await screen.findByRole("menuitemcheckbox", { name: /On-screen notifications/ });
      expect(item).toHaveAttribute("aria-checked", "false");
      await userEvent.click(item);
      await screen.findByRole("menuitemcheckbox", { name: /On-screen notifications/ });
      expect(requestPermission).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.getByRole("menuitemcheckbox", { name: /On-screen notifications/ })).toHaveAttribute("aria-checked", "true"));
      // Still open: a switch was flipped, not a page opened.
      expect(screen.getByText("Sign out")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      window.localStorage.removeItem("bitcrm.on-screen-notifications");
    }
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakeServer, renderWithClient, type FakeRoute, type FakeServer } from "@/test/page-load";
import { adminMe, profileRoutes, techMe } from "./profile-page.fixtures";

/**
 * My Profile is Workiz's user page (pg_technicians_wz_10_user_profile) —
 * "User Settings" with Actions ⌄, the small tab row, the two 480px columns
 * and the yellow Save bar — for the person signed in. A technician gets the
 * technician card's own form (their contact details, their skills and areas
 * to propose, the onboarding checklist); anyone else the same page with
 * their account. Two-step sign-in is the self-service row either way.
 */

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn() }),
  usePathname: () => "/profile",
}));
// A Google Places widget, not page data.
vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({ value, id, ariaLabel }: { value: string; id?: string; ariaLabel?: string }) => (
    <input id={id} aria-label={ariaLabel} defaultValue={value} />
  ),
}));

const { ProfilePage } = await import("./profile-page");

function serve(routes: FakeRoute[]): FakeServer {
  return installFakeServer(routes, { delayMs: 5 });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
  replace.mockReset();
});

const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);

describe("ProfilePage — the account requires two-factor authentication", () => {
  // Settings → Security Center's row is part of the page's gate: the
  // two-factor row reads "Required by your account" the moment it shows.
  it("reads 'Required by your account' on the two-factor row, switched on and locked", async () => {
    serve([
      { match: /\/users\/security-settings$/, reply: () => ({ requireMfa: true, loginCodeByEmail: false, otpByEmail: false }) },
      ...profileRoutes(adminMe),
    ]);
    renderWithClient(<ProfilePage />);

    const toggle = await screen.findByRole("switch", { name: "Two-factor authentication" }, { timeout: 3000 });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toBeDisabled();
    expect(screen.getByText("Required by your account")).toBeInTheDocument();
  });
});

describe("ProfilePage — a technician's own user page", () => {
  it("is 'User Settings' with Workiz's tabs: Profile, Availability, Commissions and ours, Documents", async () => {
    serve(profileRoutes(techMe));
    renderWithClient(<ProfilePage />);

    expect(screen.getByRole("heading", { name: "User Settings" })).toBeInTheDocument();
    await screen.findByText("Lakeside", {}, { timeout: 3000 });
    expect(tabNames()).toEqual(["Profile", "Availability", "Commissions", "Documents"]);
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens on the technician card's form: User Details, Roles and permissions, their job types and areas", async () => {
    serve(profileRoutes(techMe));
    renderWithClient(<ProfilePage />);
    await screen.findByText("Lakeside", {}, { timeout: 3000 });

    expect(screen.getByRole("heading", { name: "User Details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Roles and permissions" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("theo@example.com")).toBeDisabled();
    expect(screen.getByText("Rekey Visit")).toBeInTheDocument();
    // Their own contact details are theirs to change; a manager sets the rest.
    expect(screen.getByLabelText("Home address")).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "First name" })).toBeDisabled();
  });

  it("makes Two-factor authentication their own switch — not the admin's greyed one", async () => {
    serve(profileRoutes(techMe));
    renderWithClient(<ProfilePage />);
    await screen.findByText("Lakeside", {}, { timeout: 3000 });

    const switches = screen.getAllByRole("switch", { name: "Two-factor authentication" });
    expect(switches).toHaveLength(1);
    expect(switches[0]).toBeEnabled();
    expect(screen.getByTestId("self-two-factor")).toBeInTheDocument();
  });
});

describe("ProfilePage — anyone else's own user page", () => {
  // One tab is no choice: a strip with "Profile" alone read as a broken tab
  // row (app_audit #25), so the account page draws none.
  it("draws no tab strip — Profile would be the only tab", async () => {
    serve(profileRoutes(adminMe));
    renderWithClient(<ProfilePage />);
    await screen.findByDisplayValue("ada@example.com", {}, { timeout: 3000 });

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("lays the account out as Workiz's columns: User Details, then Roles and permissions with the role", async () => {
    serve(profileRoutes(adminMe));
    renderWithClient(<ProfilePage />);
    await screen.findByDisplayValue("ada@example.com", {}, { timeout: 3000 });

    expect(screen.getByRole("heading", { name: "User Details" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("ada@example.com")).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "First name" })).toHaveValue("Ada");
    expect(screen.getByRole("heading", { name: "Roles and permissions" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Role" })).toHaveValue("Admin");
    expect(screen.getByRole("textbox", { name: "Role" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Two-factor authentication" })).toBeEnabled();
  });

  it("saves a changed name on the user record and a changed phone as their own number", async () => {
    const puts: { path: string; body: unknown }[] = [];
    serve([
      {
        match: /\/users\/u-admin$/,
        method: "PUT",
        reply: (url, init) => {
          puts.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
          return { ...adminMe, firstName: "Adele" };
        },
      },
      {
        match: /\/users\/me$/,
        method: "PUT",
        reply: (url, init) => {
          puts.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
          return { ...adminMe, phone: "+14045550199" };
        },
      },
      ...profileRoutes(adminMe),
    ]);
    renderWithClient(<ProfilePage />);
    const first = await screen.findByRole("textbox", { name: "First name" }, { timeout: 3000 });

    fireEvent.change(first, { target: { value: "Adele" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].path).toMatch(/\/users\/u-admin$/);
    expect(puts[0].body).toEqual({ firstName: "Adele" });
  });

  it("leaves the name to whoever may edit users, and still lets them save their phone", async () => {
    serve(profileRoutes({ ...adminMe, roleId: "role-dispatcher" }));
    renderWithClient(<ProfilePage />);
    await screen.findByDisplayValue("ada@example.com", {}, { timeout: 3000 });

    expect(screen.getByRole("textbox", { name: "First name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});

describe("ProfilePage — Actions", () => {
  it("offers Reset password (asked first) and Log Out", async () => {
    const asked: string[] = [];
    serve([
      {
        match: /\/users\/auth\/password-reset$/,
        method: "POST",
        reply: (_url, init) => {
          asked.push(JSON.parse(String(init?.body)).email);
          return {};
        },
      },
      ...profileRoutes(adminMe),
    ]);
    renderWithClient(<ProfilePage />);
    await screen.findByDisplayValue("ada@example.com", {}, { timeout: 3000 });

    await userEvent.click(screen.getByRole("button", { name: /Actions/ }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Log Out" })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Reset password" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("ada@example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "Email me a code" }));
    await waitFor(() => expect(asked).toEqual(["ada@example.com"]));
  });
});

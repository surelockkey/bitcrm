import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { User } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { SelfTwoFactor } from "./self-two-factor";

/**
 * Two-step sign-in on your own profile, as the user page's "Two-factor
 * authentication ⓘ" row (pg_technicians_wz_10_user_profile): Workiz's 32×16
 * switch at the column's edge. Switching it on is proved — a code goes to the
 * phone and has to come back; with no phone yet, the phone is asked for right
 * under the row rather than leaving a greyed-out switch.
 */
const me = (extra: Partial<User> = {}): User => ({
  id: "u-1",
  cognitoSub: "s",
  email: "bob@x.com",
  firstName: "Bob",
  lastName: "Ray",
  roleId: "r",
  department: "ops",
  phone: "+14045551234",
  status: "active" as User["status"],
  createdAt: "",
  updatedAt: "",
  ...extra,
});

const calls: { path: string; body?: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  server.use(
    http.put("*/users/me", async ({ request }) => {
      const body = (await request.json()) as { phone: string };
      calls.push({ path: "phone", body });
      return HttpResponse.json({ success: true, data: me({ phone: "+15412830739" }) });
    }),
    http.post("*/users/me/mfa/start", () => {
      calls.push({ path: "start" });
      return HttpResponse.json({ success: true, data: { destination: "•••• 0739" } });
    }),
    http.post("*/users/me/mfa/confirm", async ({ request }) => {
      const body = (await request.json()) as { code: string };
      calls.push({ path: "confirm", body });
      if (body.code !== "123456") {
        return HttpResponse.json({ success: false, message: "That code is not right." }, { status: 400 });
      }
      return HttpResponse.json({ success: true, data: me({ smsMfaEnabled: true }) });
    }),
    http.delete("*/users/me/mfa", () => {
      calls.push({ path: "off" });
      return HttpResponse.json({ success: true, data: me({ smsMfaEnabled: false }) });
    }),
  );
});

function renderRow(user: User) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SelfTwoFactor me={user} />
    </QueryClientProvider>,
  );
}

const toggle = () => screen.getByRole("switch", { name: "Two-factor authentication" });

describe("SelfTwoFactor", () => {
  it("is the user page's row: the words, an ⓘ, and a switch that is off and not greyed out", () => {
    renderRow(me());

    expect(screen.getByText("Two-factor authentication")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About Two-factor authentication" })).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(toggle()).toBeEnabled();
  });

  it("is on, its ⓘ naming the phone the codes go to", () => {
    renderRow(me({ smsMfaEnabled: true }));

    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/\(404\) 555-1234/)).toBeInTheDocument();
  });

  it("switches on once the texted code comes back", async () => {
    renderRow(me());

    await userEvent.click(toggle());
    await userEvent.type(await screen.findByLabelText(/code sent to/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(toggle()).toHaveAttribute("aria-checked", "true"));
    expect(screen.queryByLabelText(/code sent to/i)).not.toBeInTheDocument();
    expect(calls.map((c) => c.path)).toEqual(["start", "confirm"]);
  });

  it("stays off for a wrong code, and says why", async () => {
    renderRow(me());

    await userEvent.click(toggle());
    await userEvent.type(await screen.findByLabelText(/code sent to/i), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/not right/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(toggle()).toHaveAttribute("aria-checked", "false");
  });

  it("asks for the phone under the row when there is none, then texts it", async () => {
    renderRow(me({ phone: undefined }));
    expect(toggle()).toBeEnabled();

    await userEvent.click(toggle());
    const form = await screen.findByTestId("two-step-phone");
    // On its way on: the switch says so while the phone is asked for.
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    await userEvent.type(within(form).getByRole("textbox"), "5412830739");
    await userEvent.click(within(form).getByRole("button", { name: "Send code" }));

    expect(await screen.findByLabelText(/code sent to/i)).toBeInTheDocument();
    expect(calls.map((c) => c.path)).toEqual(["phone", "start"]);
    expect(calls[0].body).toEqual({ phone: expect.stringContaining("5412830739") });
  });

  it("switches off in one click", async () => {
    renderRow(me({ smsMfaEnabled: true }));

    await userEvent.click(toggle());

    await waitFor(() => expect(toggle()).toHaveAttribute("aria-checked", "false"));
    expect(calls.map((c) => c.path)).toEqual(["off"]);
  });
});

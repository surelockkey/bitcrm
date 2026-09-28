import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { User } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { TwoStepCard } from "./two-step-card";

/**
 * Two-step sign-in on your own profile: a code texted to your phone after
 * the password. One switch, an On / Off you can read at a glance, and —
 * when there is no phone yet — the phone is added right here rather than
 * leaving a greyed-out control that explains itself in small print.
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

function renderCard(user: User) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TwoStepCard me={user} />
    </QueryClientProvider>,
  );
}

const toggle = () => screen.getByRole("switch", { name: /two-step sign-in/i });
const status = () => screen.getByTestId("two-step-status");

describe("TwoStepCard", () => {
  it("reads Off, with a switch that is not greyed out", () => {
    renderCard(me());

    expect(status()).toHaveTextContent(/^off$/i);
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toBeEnabled();
  });

  it("reads On, naming the phone the codes go to", () => {
    renderCard(me({ smsMfaEnabled: true }));

    expect(status()).toHaveTextContent(/^on$/i);
    expect(toggle()).toBeChecked();
    expect(screen.getByText(/1234/)).toBeInTheDocument();
  });

  it("switches on once the texted code comes back", async () => {
    renderCard(me());

    await userEvent.click(toggle());
    await userEvent.type(await screen.findByLabelText(/code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(status()).toHaveTextContent(/^on$/i));
    expect(calls.map((c) => c.path)).toEqual(["start", "confirm"]);
  });

  it("stays off for a wrong code, and says why", async () => {
    renderCard(me());

    await userEvent.click(toggle());
    await userEvent.type(await screen.findByLabelText(/code/i), "000000");
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(await screen.findByText(/not right/i)).toBeInTheDocument();
    expect(status()).toHaveTextContent(/^off$/i);
  });

  // No phone yet: the switch still works — it asks for the phone right here.
  it("asks for the phone in the card when there is none, then texts it", async () => {
    renderCard(me({ phone: undefined }));
    expect(toggle()).toBeEnabled();

    await userEvent.click(toggle());
    const form = await screen.findByTestId("two-step-phone");
    await userEvent.type(within(form).getByRole("textbox"), "5412830739");
    await userEvent.click(within(form).getByRole("button", { name: /send code/i }));

    expect(await screen.findByLabelText(/code/i)).toBeInTheDocument();
    expect(calls.map((c) => c.path)).toEqual(["phone", "start"]);
    expect(calls[0].body).toEqual({ phone: expect.stringContaining("5412830739") });
  });

  it("switches off in one click", async () => {
    renderCard(me({ smsMfaEnabled: true }));

    await userEvent.click(toggle());

    await waitFor(() => expect(status()).toHaveTextContent(/^off$/i));
    expect(calls.map((c) => c.path)).toEqual(["off"]);
  });
});

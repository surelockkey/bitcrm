import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { User } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { UserTwoStepSwitch } from "./user-two-step-switch";

vi.mock("@/features/auth/use-me", () => ({ useMe: () => ({ data: { id: "admin-1" } }) }));

/**
 * An admin's switch for someone's two-step sign-in. It saves on its own,
 * reads On / Off at a glance, and — when the person has no phone yet — asks
 * for it right in the row instead of sitting there greyed out.
 */
const user = (extra: Partial<User> = {}): User => ({
  id: "u-9",
  cognitoSub: "s",
  email: "ann@x.com",
  firstName: "Ann",
  lastName: "Lee",
  roleId: "r",
  department: "ops",
  phone: "+14045551234",
  status: "active" as User["status"],
  createdAt: "",
  updatedAt: "",
  ...extra,
});

const sent: { path: string; body: unknown }[] = [];

beforeEach(() => {
  sent.length = 0;
  server.use(
    http.put("*/users/u-9/mfa", async ({ request }) => {
      const body = (await request.json()) as { enabled: boolean };
      sent.push({ path: "mfa", body });
      return HttpResponse.json({ success: true, data: user({ smsMfaEnabled: body.enabled }) });
    }),
    http.put("*/users/u-9", async ({ request }) => {
      const body = await request.json();
      sent.push({ path: "profile", body });
      return HttpResponse.json({ success: true, data: user({ phone: "+15412830739" }) });
    }),
  );
});

function renderSwitch(u: User, canEdit = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UserTwoStepSwitch user={u} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

const toggle = () => screen.getByRole("switch", { name: /two-step sign-in/i });
const status = () => screen.getByTestId("two-step-status");

describe("UserTwoStepSwitch", () => {
  it("reads On or Off at a glance", () => {
    const { unmount } = renderSwitch(user({ smsMfaEnabled: true }));
    expect(status()).toHaveTextContent(/^on$/i);
    unmount();

    renderSwitch(user());
    expect(status()).toHaveTextContent(/^off$/i);
  });

  it("switches someone off straight away", async () => {
    renderSwitch(user({ smsMfaEnabled: true }));

    await userEvent.click(toggle());

    await waitFor(() => expect(sent).toEqual([{ path: "mfa", body: { enabled: false } }]));
    await waitFor(() => expect(status()).toHaveTextContent(/^off$/i));
  });

  it("switches someone on who has a phone", async () => {
    renderSwitch(user());

    await userEvent.click(toggle());

    await waitFor(() => expect(sent).toEqual([{ path: "mfa", body: { enabled: true } }]));
    await waitFor(() => expect(status()).toHaveTextContent(/^on$/i));
  });

  // The switch is not greyed out for a missing phone: it asks for one.
  it("takes the phone in the row when there is none, then switches on", async () => {
    renderSwitch(user({ phone: undefined }));
    expect(toggle()).toBeEnabled();

    await userEvent.click(toggle());
    const form = await screen.findByTestId("two-step-phone");
    await userEvent.type(within(form).getByRole("textbox"), "5412830739");
    await userEvent.click(within(form).getByRole("button", { name: /save & turn on/i }));

    await waitFor(() => expect(sent.map((s) => s.path)).toEqual(["profile", "mfa"]));
    expect(sent[0].body).toEqual({ phone: expect.stringContaining("5412830739") });
    await waitFor(() => expect(status()).toHaveTextContent(/^on$/i));
  });

  it("is read-only without the right to edit this person", () => {
    renderSwitch(user({ smsMfaEnabled: true }), false);

    expect(toggle()).toBeDisabled();
  });
});

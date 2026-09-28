import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { User } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { UserTwoStepSwitch } from "./user-two-step-switch";

vi.mock("@/features/auth/use-me", () => ({ useMe: () => ({ data: { id: "admin-1" } }) }));

/**
 * An admin's switch for someone else's two-step sign-in: off for a lost
 * phone, on for anyone with a phone to text. It saves on its own, like the
 * status switches, not with the profile form's Save.
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

const sent: unknown[] = [];

beforeEach(() => {
  sent.length = 0;
  server.use(
    http.put("*/users/u-9/mfa", async ({ request }) => {
      const body = (await request.json()) as { enabled: boolean };
      sent.push(body);
      return HttpResponse.json({ success: true, data: user({ smsMfaEnabled: body.enabled }) });
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

describe("UserTwoStepSwitch", () => {
  it("switches someone off straight away", async () => {
    renderSwitch(user({ smsMfaEnabled: true }));
    const toggle = screen.getByRole("switch", { name: /two-step sign-in/i });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);

    await waitFor(() => expect(sent).toEqual([{ enabled: false }]));
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it("switches someone on who has a phone", async () => {
    renderSwitch(user());

    await userEvent.click(screen.getByRole("switch", { name: /two-step sign-in/i }));

    await waitFor(() => expect(sent).toEqual([{ enabled: true }]));
  });

  it("cannot switch on someone with no phone to text", () => {
    renderSwitch(user({ phone: undefined }));

    expect(screen.getByRole("switch", { name: /two-step sign-in/i })).toBeDisabled();
    expect(screen.getByText(/no phone/i)).toBeInTheDocument();
  });

  it("is read-only without users.edit", () => {
    renderSwitch(user({ smsMfaEnabled: true }), false);

    expect(screen.getByRole("switch", { name: /two-step sign-in/i })).toBeDisabled();
  });
});

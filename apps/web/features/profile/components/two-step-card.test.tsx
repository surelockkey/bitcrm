import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { User } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { TwoStepCard } from "./two-step-card";

/**
 * Two-step sign-in on your own profile: a code texted to the phone above
 * after the password. Switching it on is proved — the code has to come back
 * from that phone — and switching it off is one click.
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

const calls: { method: string; path: string; body?: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  server.use(
    http.post("*/users/me/mfa/start", () => {
      calls.push({ method: "POST", path: "start" });
      return HttpResponse.json({ success: true, data: { destination: "•••• 1234" } });
    }),
    http.post("*/users/me/mfa/confirm", async ({ request }) => {
      const body = (await request.json()) as { code: string };
      calls.push({ method: "POST", path: "confirm", body });
      if (body.code !== "123456") {
        return HttpResponse.json({ success: false, message: "That code is not right." }, { status: 400 });
      }
      return HttpResponse.json({ success: true, data: me({ smsMfaEnabled: true }) });
    }),
    http.delete("*/users/me/mfa", () => {
      calls.push({ method: "DELETE", path: "me/mfa" });
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

describe("TwoStepCard", () => {
  it("asks for a phone first when there is none to text", () => {
    renderCard(me({ phone: undefined }));

    expect(screen.getByText(/add your phone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /turn on/i })).toBeDisabled();
  });

  it("switches on only once the texted code comes back", async () => {
    renderCard(me());

    await userEvent.click(screen.getByRole("button", { name: /turn on/i }));
    expect(await screen.findByText(/•••• 1234/)).toBeInTheDocument();
    expect(calls.map((c) => c.path)).toEqual(["start"]);

    await userEvent.type(screen.getByLabelText(/code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(await screen.findByText(/two-step sign-in is on/i)).toBeInTheDocument();
    expect(calls.find((c) => c.path === "confirm")?.body).toEqual({ code: "123456" });
  });

  it("says so for a wrong code and stays off", async () => {
    renderCard(me());
    await userEvent.click(screen.getByRole("button", { name: /turn on/i }));
    await userEvent.type(await screen.findByLabelText(/code/i), "000000");
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(await screen.findByText(/not right/i)).toBeInTheDocument();
    expect(screen.queryByText(/two-step sign-in is on/i)).toBeNull();
  });

  it("shows it on, with the phone codes go to, and switches it off", async () => {
    renderCard(me({ smsMfaEnabled: true }));

    expect(screen.getByText(/two-step sign-in is on/i)).toBeInTheDocument();
    expect(screen.getByText(/1234/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /turn off/i }));

    await waitFor(() => expect(calls.map((c) => c.path)).toContain("me/mfa"));
    expect(await screen.findByRole("button", { name: /turn on/i })).toBeInTheDocument();
  });
});

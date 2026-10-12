import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientConfirmView } from "@bitcrm/types";
import { ConfirmApp } from "./confirm-app";

const view = (over: Partial<ClientConfirmView> = {}): ClientConfirmView => ({
  state: "open",
  business: { name: "Sure Lock & Key", phone: "(203) 403-6303", logoUrl: "https://cdn.example.com/logo.png" },
  job: {
    number: "K4T9ZW",
    scheduledDate: "2026-10-14",
    scheduledTimeSlot: "09:00-11:00",
    timezone: "America/New_York",
    address: "12 Main St, Apt 3, Stamford, CT 06901",
    jobType: "Lockout",
  },
  ...over,
});

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
const fail = (status: number) =>
  new Response(JSON.stringify({ success: false, error: { code: "x", message: "This link is no longer valid" } }), { status });

const URL_ = "https://api.bitcrm.tech-slk.com/api/billing/public/confirm/tok";

afterEach(() => vi.unstubAllGlobals());

describe("ConfirmApp — the client confirms their appointment (B12)", () => {
  it("shows the company, the visit and the place, with one Confirm button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(view())));
    render(<ConfirmApp token="tok" />);

    expect(screen.getByRole("status", { name: /loading your appointment/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "Confirm your appointment" })).toBeInTheDocument();
    expect(screen.getByText("Sure Lock & Key")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Sure Lock & Key" })).toHaveAttribute("src", "https://cdn.example.com/logo.png");
    expect(screen.getByText("Wednesday, October 14, 2026")).toBeInTheDocument();
    expect(screen.getByText("9:00 AM – 11:00 AM EDT")).toBeInTheDocument();
    expect(screen.getByText("12 Main St, Apt 3, Stamford, CT 06901")).toBeInTheDocument();
    expect(screen.getByText("Lockout")).toBeInTheDocument();
    expect(screen.getByText("Job #K4T9ZW")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("Confirm posts once and turns into the thank-you", async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? ok(view({ state: "confirmed", confirmedAt: "2026-10-12T19:05:00.000Z" }))
        : ok(view()),
    );
    vi.stubGlobal("fetch", f);
    render(<ConfirmApp token="tok" />);

    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Thank you!" })).toBeInTheDocument();
    expect(screen.getByText("Your appointment is confirmed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    const posts = f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe(URL_);
    // The visit stays on screen under the thank-you.
    expect(screen.getByText("Wednesday, October 14, 2026")).toBeInTheDocument();
  });

  it("a link opened again after confirming shows the confirmation, not the button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(view({ state: "confirmed", confirmedAt: "2026-10-12T19:05:00.000Z" }))));
    render(<ConfirmApp token="tok" />);
    expect(await screen.findByText("Your appointment is confirmed.")).toBeInTheDocument();
    expect(screen.getByText("Confirmed Oct 12, 3:05 PM EDT")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a closed job is explained politely, with the number to call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(view({ state: "closed" }))));
    render(<ConfirmApp token="tok" />);
    expect(await screen.findByRole("heading", { level: 1, name: "This appointment can’t be confirmed online" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "(203) 403-6303" })).toHaveAttribute("href", "tel:2034036303");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a visit that is over says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(view({ state: "expired" }))));
    render(<ConfirmApp token="tok" />);
    expect(await screen.findByRole("heading", { level: 1, name: "This appointment has already passed" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("the job may have closed between loading and tapping: the answer is shown as it is", async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "POST" ? ok(view({ state: "closed" })) : ok(view())));
    vi.stubGlobal("fetch", f);
    render(<ConfirmApp token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("heading", { level: 1, name: "This appointment can’t be confirmed online" })).toBeInTheDocument();
  });

  it("a failed tap keeps the page and lets the client try again", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(ok(view()))
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(ok(view({ state: "confirmed", confirmedAt: "2026-10-12T19:05:00.000Z" })));
    vi.stubGlobal("fetch", f);
    render(<ConfirmApp token="tok" />);

    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn’t confirm/i);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Thank you!" })).toBeInTheDocument();
  });

  it("a dead link says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fail(404)));
    render(<ConfirmApp token="tok" />);
    expect(await screen.findByRole("heading", { level: 1, name: "This link is no longer valid" })).toBeInTheDocument();
  });

  it("a server that cannot be reached offers a retry", async () => {
    const f = vi.fn().mockResolvedValueOnce(fail(503)).mockResolvedValue(ok(view()));
    vi.stubGlobal("fetch", f);
    render(<ConfirmApp token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { level: 1, name: "Confirm your appointment" })).toBeInTheDocument();
  });

  it("a company without a logo shows its initials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(view({ business: { name: "Sure Lock & Key" } }))));
    render(<ConfirmApp token="tok" />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("SL")).toBeInTheDocument();
  });
});

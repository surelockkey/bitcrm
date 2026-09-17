import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { usePortalUrlStore } from "../store";

const perms = vi.hoisted(() => ({ send: true }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (resource: string, action = "view") =>
      action === "send" ? perms.send : resource === "contacts",
  }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { PortalLinkCard } from "./portal-link-card";
import { CopyPortalLinkButton } from "./copy-portal-link-button";

const link = { contactId: "c1", createdBy: "u1", createdAt: "2026-09-01T10:00:00.000Z" };
let writeText: ReturnType<typeof vi.fn>;
// user-event installs its own clipboard stub on setup — ours goes on after it.
const user = () => {
  const u = userEvent.setup({ pointerEventsCheck: 0 });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return u;
};

beforeEach(() => {
  perms.send = true;
  usePortalUrlStore.setState({ urls: {} });
  toast.success.mockClear();
  writeText = vi.fn().mockResolvedValue(undefined);
});

describe("PortalLinkCard", () => {
  it("offers to create a link when there is none, then shows and copies the URL", async () => {
    let created = false;
    server.use(
      http.get("*/billing/portal-links/c1", () =>
        HttpResponse.json({ success: true, data: created ? link : null }),
      ),
      http.post("*/billing/portal-links/c1", () => {
        created = true;
        return HttpResponse.json({
          success: true,
          data: { ...link, url: "http://localhost:3000/portal/tok123", token: "tok123" },
        });
      }),
    );
    renderWithClient(<PortalLinkCard contactId="c1" />);

    await user().click(await screen.findByRole("button", { name: /create link/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/portal/tok123"));
    expect(await screen.findByDisplayValue("http://localhost:3000/portal/tok123")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /preview portal/i })).toHaveAttribute("href", "/portal/preview/c1");
  });

  it("asks before regenerating an existing link whose URL is unknown", async () => {
    let posted = 0;
    server.use(
      http.get("*/billing/portal-links/c1", () => HttpResponse.json({ success: true, data: link })),
      http.post("*/billing/portal-links/c1", () => {
        posted += 1;
        return HttpResponse.json({ success: true, data: { ...link, url: "http://x/portal/new" } });
      }),
    );
    renderWithClient(<PortalLinkCard contactId="c1" />);

    await user().click(await screen.findByRole("button", { name: /regenerate & copy/i }));
    expect(await screen.findByText(/old link will stop working/i)).toBeInTheDocument();
    expect(posted).toBe(0);

    await user().click(screen.getByRole("button", { name: /^regenerate$/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://x/portal/new"));
    expect(posted).toBe(1);
  });

  it("hides link management without send permission", async () => {
    perms.send = false;
    server.use(http.get("*/billing/portal-links/c1", () => HttpResponse.json({ success: true, data: null })));
    renderWithClient(<PortalLinkCard contactId="c1" />);
    expect(await screen.findByText(/no portal link yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create link/i })).not.toBeInTheDocument();
  });
});

describe("CopyPortalLinkButton", () => {
  it("copies a URL generated earlier this session without asking", async () => {
    usePortalUrlStore.setState({ urls: { c1: "http://x/portal/known" } });
    renderWithClient(<CopyPortalLinkButton contactId="c1" />);
    await user().click(screen.getByRole("button", { name: /copy client portal link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://x/portal/known"));
  });

  it("creates a link straight away when the client has none", async () => {
    server.use(
      http.get("*/billing/portal-links/c1", () => HttpResponse.json({ success: true, data: null })),
      http.post("*/billing/portal-links/c1", () =>
        HttpResponse.json({ success: true, data: { ...link, url: "http://x/portal/first" } }),
      ),
    );
    renderWithClient(<CopyPortalLinkButton contactId="c1" />);
    await user().click(screen.getByRole("button", { name: /copy client portal link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://x/portal/first"));
  });
});

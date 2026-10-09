import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Workiz Phone → Texting (the messaging settings, with the message templates
 * under "Text templates") does not jump.
 *
 * It said "No access" until the permissions came, then drew the default
 * sender as a free-text box and swapped it for the number picker once the
 * numbers arrived, a beat after the settings. The templates, once a page of
 * their own, now come in the same frame as the rest.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/calls/texting",
  useSearchParams: () => new URLSearchParams(),
}));
const perms = vi.hoisted(() => ({ isLoading: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: () => !perms.isLoading,
    isTechnician: false,
    isLoading: perms.isLoading,
    me: perms.isLoading ? undefined : { id: "me" },
  }),
}));

const routes: FakeRoute[] = [
  { match: /\/messaging\/settings$/, reply: () => ({ defaultSenderNumber: "+14045550100" }) },
  // The numbers the sender picker offers answer after the settings.
  { match: /\/telephony\/numbers$/, reply: () => [{ sid: "PN1", phoneNumber: "+14045550100", friendlyName: "Main" }], delayMs: 70 },
  { match: /\/messaging\/templates\/short-codes$/, reply: () => [{ code: "first_name", group: "client", description: "", example: "" }], delayMs: 60 },
  {
    match: /\/messaging\/templates$/,
    delayMs: 90,
    reply: () => [
      {
        id: "t1",
        messageTemplateTitle: "On our way",
        messageTemplate: "<p>Hi</p>",
        channel: "sms",
        isDefault: false,
        active: true,
        createdBy: "u",
        createdAt: "x",
        updatedAt: "x",
      },
    ],
  },
];

let server: FakeServer;

const { MessagingSettingsPage } = await import("./messaging-settings-page");

const renderPage = (page: ReactElement) => renderWithClient(<TooltipProvider>{page}</TooltipProvider>);

beforeEach(() => {
  perms.isLoading = false;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("messaging settings — no jumping", () => {
  it("waits for the permissions instead of saying No access", async () => {
    perms.isLoading = true;
    renderPage(<MessagingSettingsPage />);
    await settle(30);

    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(skeletonCount()).toBeGreaterThan(0);
  });

  it("draws the sender as the number picker, and the templates, from its first frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Sender"),
      () => ({
        picker: !!screen.queryByRole("combobox", { name: "Default number" }),
        templates: !!screen.queryByText("On our way"),
        skeletons: skeletonCount(),
      }),
    );
    renderPage(<MessagingSettingsPage />);
    await screen.findByText("Sender", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ picker: true, templates: true, skeletons: 0 });
  });

  it("asks for each thing once", async () => {
    renderPage(<MessagingSettingsPage />);
    await screen.findByText("On our way", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});

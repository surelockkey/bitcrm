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
 * Settings → Messaging and Message templates do not jump.
 *
 * Both said "No access" until the permissions came. Messaging then drew the
 * default sender as a free-text box and swapped it for the number picker
 * once the numbers arrived, a beat after the settings.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/messaging",
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
  {
    match: /\/messaging\/templates$/,
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
const { TemplatesPage } = await import("./templates-page");

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
  it.each([
    ["Messaging", <MessagingSettingsPage key="m" />],
    ["Message templates", <TemplatesPage key="t" />],
  ])("%s waits for the permissions instead of saying No access", async (_name, page) => {
    perms.isLoading = true;
    renderPage(page);
    await settle(30);

    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(skeletonCount()).toBeGreaterThan(0);
  });

  it("Messaging draws the sender as the number picker from its first frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Sender"),
      () => ({
        picker: !!screen.queryByRole("combobox", { name: "Default number" }),
        skeletons: skeletonCount(),
      }),
    );
    renderPage(<MessagingSettingsPage />);
    await screen.findByText("Sender", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ picker: true, skeletons: 0 });
  });

  it.each([
    ["Messaging", <MessagingSettingsPage key="m" />, "Sender"],
    ["Message templates", <TemplatesPage key="t" />, "On our way"],
  ])("%s asks for each thing once", async (_name, page, text) => {
    renderPage(page);
    await screen.findByText(text, {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});

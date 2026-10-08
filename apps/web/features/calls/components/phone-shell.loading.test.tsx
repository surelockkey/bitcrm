import { useEffect } from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { installFakeServer, renderWithClient, settle, type FakeRoute } from "@/test/page-load";

/**
 * A settings page drawn as a tab of the Phone section (`/calls/numbers`, …):
 * the heading, its number pill and the tab strip over the page. The pill is
 * fetched; it must not pop in beside a page that is already up, so the page
 * under the strip is shown in the same frame as the pill — while the page
 * itself mounts at once and starts its own requests.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/calls/numbers",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false, isTechnician: false }),
}));

const routes: FakeRoute[] = [{ match: /\/messaging\/settings$/, reply: () => ({ defaultSenderNumber: "+12034036303" }), delayMs: 80 }];

const { PhoneTabPage } = await import("./phone-shell");

const onMount = vi.fn();
function Inner() {
  useEffect(() => onMount(), []);
  return <p>the settings page</p>;
}

beforeEach(() => {
  onMount.mockReset();
  installFakeServer(routes);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PhoneTabPage", () => {
  it("mounts the page at once, but shows it with the pill, in one frame", async () => {
    renderWithClient(
      <PhoneTabPage>
        <Inner />
      </PhoneTabPage>,
    );
    expect(onMount).toHaveBeenCalled();
    const page = screen.getByText("the settings page").parentElement!;
    expect(page.className).toContain("invisible");
    expect(screen.queryByText("(203) 403-6303")).not.toBeInTheDocument();

    await screen.findByText("(203) 403-6303", {}, { timeout: 2000 });
    expect(page.className).not.toContain("invisible");
  });

  it("keeps the heading and the tabs up from the first frame", async () => {
    renderWithClient(
      <PhoneTabPage>
        <Inner />
      </PhoneTabPage>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "BitCRM Phone" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Phone numbers" })).toHaveAttribute("aria-current", "page");
    await settle();
  });
});

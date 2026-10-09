import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { duplicates, installFakeServer, renderWithClient, settle, watchFirstFrame, type FakeServer } from "@/test/page-load";

/**
 * The Reports hub does not jump.
 *
 * Until the role was read nothing was refused, so every tile was drawn; a
 * moment later the tiles the role may not open — Payments, Tax, Commissions
 * for a dispatcher without money — were taken out, and every tile after them
 * moved up a place. Now the tiles wait for the role and come once, the right
 * ones.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// A role without money or commissions, read from the server as the app reads it.
const REFUSED = new Set(["financials.view", "payments.view", "commission.view"]);
vi.mock("@/features/auth/use-permissions", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const useMe = () =>
    useQuery({ queryKey: ["me"], queryFn: () => fetch("/api/users/me").then((r) => r.json()), staleTime: Infinity });
  return {
    usePermissions: () => {
      const me = useMe();
      return { can: (r: string, a = "view") => !me.isLoading && !REFUSED.has(`${r}.${a}`), isLoading: me.isLoading };
    },
    useDenied: () => {
      const me = useMe();
      return (r: string, a = "view") => !me.isLoading && REFUSED.has(`${r}.${a}`);
    },
  };
});

let server: FakeServer;

const { ReportsPage } = await import("./reports-page");

const tiles = () => [...document.querySelectorAll('[data-slot="wz-hub-card-title"]')].map((n) => n.textContent);

beforeEach(() => {
  server = installFakeServer([{ match: /\/users\/me$/, raw: true, reply: () => ({ id: "u-disp" }), delayMs: 40 }]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReportsPage — no jumping", () => {
  it("draws only the role's tiles, from the first frame they show", async () => {
    const watch = watchFirstFrame(() => tiles().length > 0, () => tiles());
    renderWithClient(<ReportsPage />);
    await screen.findByText("Jobs", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual(tiles());
    expect(watch.frame()).not.toContain("Tax");
    expect(watch.frame()).not.toContain("Commissions (Legacy)");
  });

  it("asks for the role once", async () => {
    renderWithClient(<ReportsPage />);
    await screen.findByText("Jobs", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});

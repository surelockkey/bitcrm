import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ActivityRow } from "@bitcrm/types";
import {
  declaredRowHeights,
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  watchLoadingRowHeights,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";

/**
 * Activity does not jump.
 *
 * The footer ("Showing 0 to 0 … Page 1") stood under five grey rows from
 * the first frame; the rows came and pushed it down, its "of N results" and
 * "Page 1 of N" came a beat later and grew it, and the User column turned
 * from stored e-mails into names when the team directory came. A new period
 * blanked the total and brought it back. Now the table, its footer with the
 * total and the names come in one frame, and a new period keeps the rows and
 * the total on screen until the new ones are in.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

const row = (n: number, day: string): ActivityRow => ({
  id: `a${n}`,
  timestamp: `${day}T15:0${n}:00.000Z`,
  actorId: "u1",
  actorName: "ann@example.test",
  imported: false,
  text: `Changed job status ${day} #${n}`,
  dealId: `d${n}`,
  jobRef: `J${n}`,
});

const routes: FakeRoute[] = [
  // The rows first, the count after them, the team's names last — the order dev answers in.
  {
    match: /\/deals\/activity$/,
    raw: true,
    reply: (url) => {
      const day = url.searchParams.get("from")!;
      return { success: true, data: [row(1, day), row(2, day), row(3, day)], pagination: {} };
    },
    delayMs: 40,
  },
  {
    match: /\/deals\/activity\/count$/,
    reply: (url) => ({ total: url.searchParams.get("from") === "2026-10-05" ? 1234 : 3, atLeast: false }),
    delayMs: 80,
  },
  {
    match: /\/users$/,
    raw: true,
    reply: () => ({ success: true, data: [{ id: "u1", firstName: "Ann", lastName: "Lee", email: "ann@example.test" }], pagination: {} }),
    delayMs: 120,
  },
];

let server: FakeServer;

const { ActivityPage } = await import("./activity-page");

const footer = () => [...document.querySelectorAll("span")].find((s) => s.textContent?.startsWith("Showing"));
const rowsUp = () => !!screen.queryByText("Changed job status 2026-10-06 #1");

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ActivityPage — no jumping", () => {
  it("draws the rows, the footer with its total and the names in one frame", async () => {
    const watch = watchFirstFrame(
      () => rowsUp() || !!footer(),
      () => ({
        rows: rowsUp(),
        total: footer()?.textContent ?? null,
        names: screen.queryAllByText("Ann Lee").length,
        skeletons: skeletonCount(),
      }),
    );
    renderWithClient(<ActivityPage today="2026-10-06" />);
    await screen.findAllByText("Ann Lee", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({ rows: true, total: "Showing 1 to 3 of 3 results", names: 3, skeletons: 0 });
  });

  it("keeps the rows and the total on screen while another period loads", async () => {
    renderWithClient(<ActivityPage today="2026-10-06" />);
    await screen.findAllByText("Ann Lee", {}, { timeout: 3000 });
    await settle();

    let blanked = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0 || !footer()?.textContent?.includes("results")) blanked = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    fireEvent.click(screen.getByRole("button", { name: /^Date range:/ }));
    fireEvent.click(screen.getByRole("option", { name: "Yesterday" }));
    await screen.findByText("Showing 1 to 3 of 1234 results", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blanked).toBe(false);
  });

  it("asks for each thing once", async () => {
    renderWithClient(<ActivityPage today="2026-10-06" />);
    await screen.findAllByText("Ann Lee", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });

  // app_audit 2026-10-09: CLS 0.02 — the loader's 57px blanks became Workiz's
  // 58px rows (the Action column's 18px icon, rep_activity). Blanks, records
  // and filler now all declare the 58px.
  it("lands its rows on the loader's blank rows — the same declared row height before and after", async () => {
    const watch = watchLoadingRowHeights();
    renderWithClient(<ActivityPage today="2026-10-06" />);
    await screen.findAllByText("Ann Lee", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual(["58px"]);
    expect(declaredRowHeights()).toEqual(["58px"]);
  });
});

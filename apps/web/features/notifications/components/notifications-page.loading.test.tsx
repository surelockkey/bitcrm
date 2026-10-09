import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  declaredRowHeights,
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";
import { NOTIFICATION_CATEGORY, toSpec } from "../lib";
import { NotificationsPage } from "./notifications-page";

/**
 * The Notifications page appears once, whole: one skeleton under the band
 * until the rules, the people they name and the editor's catalogs are in,
 * then "Add New", the strip and the rows in the same frame — a row that
 * read "Unknown user" and then the person's name a beat later would have
 * re-sorted under the reader.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/notifications",
  useSearchParams: () => new URLSearchParams(),
}));

const me = {
  id: "u-admin",
  firstName: "Ada",
  lastName: "Admin",
  email: "ada@example.com",
  roleId: "role-admin",
  status: "active",
  createdAt: "",
  updatedAt: "",
};
const stamp = { createdAt: "", updatedAt: "" };

const rules = [
  {
    id: "missed",
    name: "Call alert / Missed",
    enabled: false,
    category: NOTIFICATION_CATEGORY,
    spec: toSpec({ kind: "call_alert", notifyBy: "sms", callStatus: "missed", userIds: ["u1"] }),
    ...stamp,
  },
];
const users = [
  { id: "u1", firstName: "System", lastName: "admin", email: "system.admin@surelockkey.com", roleId: "role-admin", status: "active", ...stamp },
];

const routes = (order: "user-last" | "rules-last" | "people-last"): FakeRoute[] => [
  { match: /\/users\/me$/, reply: () => me, delayMs: order === "user-last" ? 120 : 20 },
  { match: /\/messaging\/automations$/, reply: () => rules, delayMs: order === "rules-last" ? 120 : 30 },
  // The directory names the row: answered last, the row would have changed its words.
  {
    match: /\/users$/,
    reply: () => ({ success: true, data: users, pagination: { count: 1 } }),
    raw: true,
    delayMs: order === "people-last" ? 120 : 40,
  },
  { match: /\/deals\/job-statuses$/, reply: () => [] },
  { match: /\/deals\/job-sources$/, reply: () => [] },
  { match: /\/deals\/job-types$/, reply: () => [] },
  { match: /\/deals\/service-areas$/, reply: () => [] },
  { match: /\/messaging\/templates\/short-codes$/, reply: () => [] },
];

interface Frame {
  noAccess: boolean;
  skeletons: number;
  row: boolean;
  named: boolean;
  button: boolean;
}

function recordFrames(probe: () => Frame) {
  const frames: Frame[] = [];
  let last = "";
  const take = () => {
    const f = probe();
    const key = JSON.stringify(f);
    if (key !== last) {
      frames.push(f);
      last = key;
    }
  };
  const observer = new MutationObserver(take);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  return { frames: () => frames, stop: () => observer.disconnect() };
}

let server: FakeServer;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Notifications page", () => {
  it.each(["user-last", "rules-last", "people-last"] as const)(
    "goes from one skeleton straight to the whole page (%s)",
    async (order) => {
      server = installFakeServer(routes(order));
      const rec = recordFrames(() => ({
        noAccess: !!screen.queryByText("No access"),
        skeletons: skeletonCount(),
        row: !!screen.queryByText(/when call is/),
        named: !!screen.queryByText(/Notify System admin when call is/),
        button: screen.queryAllByRole("button", { name: "Add New" }).length > 0,
      }));
      renderWithClient(
        <TooltipProvider>
          <NotificationsPage />
        </TooltipProvider>,
      );
      await screen.findByText(/Notify System admin when call is/);
      await settle();
      rec.stop();
      const frames = rec.frames();

      expect(frames.some((f) => f.noAccess)).toBe(false);
      const first = frames.findIndex((f) => f.row);
      for (const f of frames.slice(0, first)) {
        expect(f).toEqual(expect.objectContaining({ row: false, button: false }));
        expect(f.skeletons).toBeGreaterThan(0);
      }
      // The frame the rows arrive in names the person, has the button, and no skeleton left.
      expect(frames[first]).toEqual({ noAccess: false, skeletons: 0, row: true, named: true, button: true });
      for (const f of frames.slice(first)) expect(f.row).toBe(true);

      // 72px rows, declared, so the pager under them never moves.
      expect(declaredRowHeights()).toEqual(["72px"]);
      expect(duplicates(server.requests)).toEqual([]);
      expect(server.unanswered).toEqual([]);
    },
  );
});

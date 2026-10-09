import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { InventoryStatus, UserContainerAccess } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeServer,
} from "@/test/page-load";
import { meRoute, renderPage, screen } from "@/features/inventory/loading-harness";

/**
 * My Stock appears once, whole.
 *
 * It came in two waves: a skeleton until the van was known, then the van's
 * name and counts over three grey cards, then the parts — the header drawn,
 * the list filling in under it. Now one skeleton holds until the van and what
 * is on it are both in.
 */

const stamp = { createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" };

let server: FakeServer;

const { MyStockPage } = await import("./my-stock-page");

beforeEach(() => {
  server = installFakeServer([
    meRoute("role-technician", 20),
    {
      match: /\/inventory\/user-containers\/me$/,
      reply: () => ({ userId: "u-me", userName: "Dana Office", access: UserContainerAccess.CONTAINER, containerId: "v1", limited: false, updatedAt: stamp.updatedAt }),
      delayMs: 30,
    },
    {
      match: /\/inventory\/containers\/v1$/,
      reply: () => ({ id: "v1", name: "Van Alpha", department: "Field", status: InventoryStatus.ACTIVE, ...stamp }),
      delayMs: 30,
    },
    {
      match: /\/inventory\/stock\/locations\/container\/v1$/,
      reply: () => ({
        name: "Van Alpha",
        status: InventoryStatus.ACTIVE,
        rows: [
          { productId: "p1", productName: "Test blank", sku: "TB-1", category: "Keys", quantity: 40 },
          { productId: "p2", productName: "Test cylinder", sku: "TC-1", category: "Locks", quantity: 1, minimumStockLevel: 5 },
        ],
      }),
      delayMs: 60,
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MyStockPage — no jumping", () => {
  it("draws the van, its totals and its parts in one frame, after one skeleton", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByRole("heading", { name: "Van Alpha" }),
      () => ({
        parts: !!screen.queryByText("Test blank") && !!screen.queryByText("Test cylinder"),
        onHand: !!screen.queryByRole("heading", { name: "Total Items On Hand: 41" }),
        lowTag: !!screen.queryByText("Low stock"),
        skeletons: skeletonCount(),
      }),
    );
    renderPage(<MyStockPage />);
    expect(skeletonCount()).toBeGreaterThan(0);
    await screen.findByText("Test cylinder", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ parts: true, onHand: true, lowTag: true, skeletons: 0 });
  });

  it("asks for each thing once", async () => {
    renderPage(<MyStockPage />);
    await screen.findByText("Test cylinder", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});

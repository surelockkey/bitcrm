import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EstimateItemBody } from "./schemas";

const mocks = vi.hoisted(() => ({ posts: [] as { url: string; body: unknown }[], failAt: -1 }));

vi.mock("@/lib/api/http", () => ({
  http: {
    post: async (url: string, body: unknown) => {
      if (mocks.posts.length === mocks.failAt) throw new Error("Refused");
      mocks.posts.push({ url, body });
      return { lineId: `l${mocks.posts.length}` };
    },
  },
}));

import { addEstimateItems } from "./api";

const line = (name: string): EstimateItemBody => ({
  productId: `p-${name}`,
  name,
  sku: "",
  quantity: 1,
  priceClient: 10,
  costCompany: 0,
  costForTech: 0,
  taxable: true,
});

beforeEach(() => {
  mocks.posts = [];
  mocks.failAt = -1;
});

describe("addEstimateItems — an item group's lines on an estimate", () => {
  it("adds every line, in the group's order, one request each", async () => {
    await expect(addEstimateItems("e1", [line("Door"), line("Labor")])).resolves.toBe(2);

    expect(mocks.posts.map((p) => [p.url, (p.body as EstimateItemBody).name])).toEqual([
      ["/billing/estimates/e1/items", "Door"],
      ["/billing/estimates/e1/items", "Labor"],
    ]);
  });

  it("stops at the first refusal and says how many went on", async () => {
    mocks.failAt = 1;

    await expect(addEstimateItems("e1", [line("Door"), line("Labor"), line("Trip")])).rejects.toThrow(
      "Refused (1 of 3 items were added)",
    );
    expect(mocks.posts).toHaveLength(1);
  });
});

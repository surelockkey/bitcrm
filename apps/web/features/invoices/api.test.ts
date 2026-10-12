import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EstimateItemBody } from "@/features/estimates/schemas";

const mocks = vi.hoisted(() => ({ posts: [] as { url: string; body: unknown }[], failAt: -1 }));

vi.mock("@/lib/api/http", () => ({
  http: {
    post: async (url: string, body: unknown) => {
      if (mocks.posts.length === mocks.failAt) throw new Error("Refused");
      mocks.posts.push({ url, body });
      return { id: "i1", items: mocks.posts.length };
    },
  },
}));

import { addInvoiceItems } from "./api";

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

describe("addInvoiceItems — an item group's lines on a client invoice", () => {
  it("adds every line in order and answers the invoice as the last one left it", async () => {
    await expect(addInvoiceItems("i1", [line("Door"), line("Labor")])).resolves.toEqual({ id: "i1", items: 2 });

    expect(mocks.posts.map((p) => [p.url, (p.body as EstimateItemBody).name])).toEqual([
      ["/billing/invoices/i1/items", "Door"],
      ["/billing/invoices/i1/items", "Labor"],
    ]);
  });

  it("stops at the first refusal and says how many went on", async () => {
    mocks.failAt = 0;

    await expect(addInvoiceItems("i1", [line("Door"), line("Labor")])).rejects.toThrow("Refused (0 of 2 items were added)");
  });
});

import { describe, it, expect, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import PriceBookPage from "./page";

describe("/price-book", () => {
  it("lands on the Items tab", () => {
    PriceBookPage();
    expect(redirect).toHaveBeenCalledWith("/price-book/items");
  });
});

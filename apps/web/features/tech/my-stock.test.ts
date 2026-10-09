import { describe, expect, it } from "vitest";
import { myStockCsv, myStockRows, myStockTotals, stockFigure } from "./my-stock";

const API_ROWS = [
  { productId: "p1", productName: "Key blank", sku: "KEY-1", category: "Keys", quantity: 120, priceClient: 2.5, costCompany: 0.4 },
  { productId: "p2", productName: "Deadbolt", sku: "LOCK-1", category: "Locks", quantity: 2, priceClient: 125, costCompany: 20.16, minimumStockLevel: 10 },
  { productId: "p3", productName: "Cylinder", quantity: 3 },
];

describe("myStockRows — the van's stock as the grid lists it", () => {
  it("names, prices and costs each row, and floats low stock to the top", () => {
    const rows = myStockRows(API_ROWS);
    expect(rows.map((r) => r.productId)).toEqual(["p2", "p3", "p1"]);
    expect(rows[0]).toMatchObject({ name: "Deadbolt", sku: "LOCK-1", quantity: 2, unitPrice: 125, cost: 20.16, isLow: true });
    expect(rows[1]).toMatchObject({ name: "Cylinder", isLow: false });
    expect(rows[1].cost).toBeUndefined();
  });
});

describe("myStockTotals — the sheet's right-hand figures", () => {
  it("adds up what is on hand, its cost and its sale value, and counts the low rows", () => {
    expect(myStockTotals(myStockRows(API_ROWS))).toEqual({
      onHand: 125,
      items: 3,
      low: 1,
      cost: 120 * 0.4 + 2 * 20.16,
      sale: 120 * 2.5 + 2 * 125,
    });
  });
});

describe("stockFigure — numbers as Workiz prints them in the sheet", () => {
  it("prints plain figures: no thousands separator, no padded decimals", () => {
    expect(stockFigure(125)).toBe("125");
    expect(stockFigure(20.16)).toBe("20.16");
    expect(stockFigure(36996.365)).toBe("36996.365");
    expect(stockFigure(0.1 + 0.2)).toBe("0.3");
  });

  it("prints nothing for a figure the row does not have", () => {
    expect(stockFigure(undefined)).toBe("");
    expect(stockFigure(Number.NaN)).toBe("");
  });
});

describe("myStockCsv — Export", () => {
  it("writes the grid's columns for every row, quoting what needs it", () => {
    const rows = myStockRows([{ productId: "p9", productName: 'Valve 3/4", brass', sku: "V-34", category: "Plumbing", quantity: 4 }]);
    expect(myStockCsv(rows, { money: false })).toBe(
      ["Product Name,SKU,Category,Quantity", '"Valve 3/4"", brass",V-34,Plumbing,4'].join("\r\n"),
    );
  });

  it("adds Price and Cost only for a viewer who may see money", () => {
    const csv = myStockCsv(myStockRows(API_ROWS.slice(1, 2)), { money: true });
    expect(csv).toBe(["Product Name,SKU,Category,Quantity,Price,Cost", "Deadbolt,LOCK-1,Locks,2,125,20.16"].join("\r\n"));
  });
});

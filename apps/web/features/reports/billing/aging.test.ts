import { describe, expect, it, vi } from "vitest";
import {
  AGING_CARD_TONES,
  agingCardText,
  agingColumnIds,
  agingPager,
  agingParams,
  agingSubline,
} from "./aging";

describe("agingCardText — Workiz's card words (rep_aging_wz_01_default)", () => {
  it("prints the balance and Workiz's captions, the count raw", () => {
    expect(agingCardText("all", { count: 564, amount: 490312.15 }, true)).toEqual({
      value: "$490,312.15",
      caption: "564 invoices due",
      label: "$490,312.15 564 invoices due",
    });
    expect(agingCardText("under30", { count: 34, amount: 24508.45 }, true)).toEqual({
      value: "$24,508.45",
      caption: "under 30 days (34)",
      label: "$24,508.45 under 30 days (34)",
    });
    expect(agingCardText("from30to60", { count: 25, amount: 10516.67 }, true).caption).toBe("30-60 days (25)");
    expect(agingCardText("from60to90", { count: 16, amount: 19086.59 }, true).caption).toBe("60-90 days (16)");
    expect(agingCardText("over90", { count: 1235, amount: 61496.28 }, true).caption).toBe("over 90 days (1235)");
  });

  it("reads an empty card as Workiz does: $0.00 and (0)", () => {
    expect(agingCardText("from60to90", undefined, true)).toMatchObject({ value: "$0.00", caption: "60-90 days (0)" });
    expect(agingCardText("all", { count: 0, amount: 0 }, true)).toMatchObject({ value: "$0.00", caption: "0 invoices due" });
  });

  it("without financials.view puts the count where the money was", () => {
    expect(agingCardText("all", { count: 564, amount: 490312.15 }, false)).toEqual({
      value: "564",
      caption: "invoices due",
      label: "564 invoices due",
    });
    expect(agingCardText("over90", { count: 235, amount: 61496.28 }, false)).toEqual({
      value: "235",
      caption: "over 90 days",
      label: "235 over 90 days",
    });
  });
});

describe("AGING_CARD_TONES — the five rules, dark to red", () => {
  it("follows Workiz's card classes", () => {
    expect(AGING_CARD_TONES).toEqual({
      all: "ink",
      under30: "lightYellow",
      from30to60: "orange",
      from60to90: "lightRed",
      over90: "red",
    });
  });
});

describe("agingParams — what the page asks the server", () => {
  it("leaves the order to the server until a header is clicked (Workiz `sorted: []`)", () => {
    expect(agingParams({ bucket: "all", sort: null, page: 1, pageSize: 10 })).toEqual({ bucket: "all", page: 1, pageSize: 10 });
  });

  it("sends the clicked column and its way", () => {
    expect(agingParams({ bucket: "over90", sort: { column: "total", dir: "asc" }, page: 3, pageSize: 25 })).toEqual({
      bucket: "over90",
      sort: "total",
      dir: "asc",
      page: 3,
      pageSize: 25,
    });
  });

  it("ignores a column the server cannot sort by", () => {
    expect(agingParams({ bucket: "all", sort: { column: "nope", dir: "desc" }, page: 1, pageSize: 10 })).toEqual({
      bucket: "all",
      page: 1,
      pageSize: 10,
    });
  });
});

describe("agingColumnIds — the grid's columns", () => {
  it("is Workiz's eight, in Workiz's order", () => {
    expect(agingColumnIds(true)).toEqual(["number", "name", "client", "total", "balance", "dueDate", "createdAt", "daysLate"]);
  });

  it("drops the money without financials.view", () => {
    expect(agingColumnIds(false)).toEqual(["number", "name", "client", "dueDate", "createdAt", "daysLate"]);
  });
});

describe("agingSubline — the line under the client's name", () => {
  it("is the email when there is one (Workiz's ClientTableCell)", () => {
    expect(agingSubline({ clientEmail: "245110@carmax.com", clientPhone: "8605297621" })).toEqual({
      kind: "email",
      text: "245110@carmax.com",
    });
  });

  it("is the phone, formatted, when there is no email", () => {
    expect(agingSubline({ clientPhone: "2102691344" })).toEqual({ kind: "phone", text: "(210) 269-1344", tel: "2102691344" });
  });

  it("is nothing without either", () => {
    expect(agingSubline({})).toBeNull();
  });
});

describe("agingPager — react-table's footer over numbered pages", () => {
  it("counts the rows on screen", () => {
    const onPage = vi.fn();
    const p = agingPager({ page: 1, pageSize: 10, total: 564, shown: 10, fetching: false, onPage });
    expect(p).toMatchObject({ page: 1, from: 1, to: 10, total: 564, totalPages: 57, canPrev: false, canNext: true });
    p.next();
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("stops at the last page", () => {
    const onPage = vi.fn();
    const p = agingPager({ page: 57, pageSize: 10, total: 564, shown: 4, fetching: false, onPage });
    expect(p).toMatchObject({ from: 561, to: 564, canPrev: true, canNext: false });
    p.prev();
    expect(onPage).toHaveBeenCalledWith(56);
  });

  it("reads an empty card as 'Showing 1 to 0 of 0', 'Page 1 of 1'", () => {
    const p = agingPager({ page: 1, pageSize: 10, total: 0, shown: 0, fetching: false, onPage: () => {} });
    expect(p).toMatchObject({ from: 0, to: 0, total: 0, totalPages: 0, canPrev: false, canNext: false });
  });

  it("holds the arrows while a page is on its way", () => {
    const p = agingPager({ page: 2, pageSize: 10, total: 564, shown: 10, fetching: true, onPage: () => {} });
    expect(p.isFetching).toBe(true);
  });
});

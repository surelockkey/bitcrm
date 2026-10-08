import { describe, expect, it } from "vitest";
import { callsKpis, type CallsSummary } from "./kpis";

/**
 * The stat cards over Workiz's call log (callspage_wz_01_today, _10_last7):
 * MISSED CALLS · CALLS (N callers) · DISPATCHER SCORE · CONVERSION RATE ·
 * REVENUE. Ours draw only what we have numbers for — Dispatcher score has no
 * source at all, and the rest come from `GET /telephony/calls/stats/summary`
 * when the server has it; the CALLS number is the log's own count.
 */
const summary: CallsSummary = { calls: 647, callers: 226, missed: 59, active: 5, jobs: 18, revenue: 2845.89, atLeast: false };

describe("callsKpis", () => {
  it("draws Workiz's cards in Workiz's order, without Dispatcher score", () => {
    const cards = callsKpis({ count: { total: 647 }, summary, showMoney: true });
    expect(cards.map((c) => c.label)).toEqual(["MISSED CALLS", "CALLS", "CONVERSION RATE", "REVENUE"]);
  });

  it("prints the numbers as Workiz does: bare counts, callers aside, money with cents", () => {
    const cards = callsKpis({ count: { total: 6594 }, summary: { ...summary, calls: 6594, callers: 1439, revenue: 76071.97 }, showMoney: true });
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(byId.calls.value).toBe("6594");
    expect(byId.calls.aside).toBe("1439 callers");
    expect(byId.revenue.value).toBe("$76,071.97");
  });

  it("turns missed calls red only when there are some", () => {
    expect(callsKpis({ count: { total: 1 }, summary, showMoney: true })[0]).toMatchObject({ value: "59", alert: true });
    expect(callsKpis({ count: { total: 1 }, summary: { ...summary, missed: 0 }, showMoney: true })[0]).toMatchObject({
      value: "0",
      alert: false,
    });
  });

  it("works conversion out as jobs per caller, one decimal", () => {
    const conversion = (s: Partial<CallsSummary>) =>
      callsKpis({ count: { total: 1 }, summary: { ...summary, ...s }, showMoney: true }).find((c) => c.id === "conversion")?.value;
    expect(conversion({ jobs: 18, callers: 226 })).toBe("8.0%");
    expect(conversion({ jobs: 1, callers: 3 })).toBe("33.3%");
    expect(conversion({ jobs: 0, callers: 0 })).toBe("0.0%");
  });

  it("leaves Revenue out for a viewer who may not see money, or when the server sent none", () => {
    expect(callsKpis({ count: { total: 1 }, summary, showMoney: false }).map((c) => c.id)).not.toContain("revenue");
    const { revenue: _drop, ...noMoney } = summary;
    expect(callsKpis({ count: { total: 1 }, summary: noMoney, showMoney: true }).map((c) => c.id)).not.toContain("revenue");
  });

  it("marks a count the server stopped short on", () => {
    expect(callsKpis({ count: { total: 2000, atLeast: true }, showMoney: true })).toEqual([
      { id: "calls", label: "CALLS", value: "2000+", alert: false },
    ]);
  });

  it("falls back to the log's own count when the summary is not served", () => {
    expect(callsKpis({ count: { total: 647 }, showMoney: true })).toEqual([
      { id: "calls", label: "CALLS", value: "647", alert: false },
    ]);
  });

  it("draws nothing when there is no number at all", () => {
    expect(callsKpis({ showMoney: true })).toEqual([]);
  });
});

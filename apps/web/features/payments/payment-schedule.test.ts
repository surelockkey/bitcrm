import { describe, expect, it } from "vitest";
import type { PaymentScheduleLine, PaymentScheduleView } from "@bitcrm/types";
import {
  MAX_SCHEDULED_PAYMENTS,
  addEntry,
  canAddEntry,
  defaultDraft,
  draftProblem,
  fromView,
  previewLines,
  removeEntry,
  scheduleStatus,
  scheduleSummary,
  switchMethod,
  toBody,
  type ScheduleDraft,
} from "./payment-schedule";

const TODAY = "2026-10-06";

/**
 * Workiz's "Add payment schedule" window on the web (help centre 38044340324753,
 * screenshots in the parser's docs/import/mobile-payments-2026-10-02/hc-38044340324753-*):
 * the job total split by % or $, "Add from 2 up to 12 payments", each with a due
 * date and a note. The dollars are billing's (`payment-schedule.rules.ts`): a
 * percentage split to the cent, the last payment taking the rest; what billing
 * would refuse is said before Save. Ported from the mobile app (feat/payment-schedule).
 */
describe("payment schedule — the editor", () => {
  it("starts as two payments of half the total, the second due the day after", () => {
    const d = defaultDraft(TODAY);
    expect(d.method).toBe("percent");
    expect(d.entries.map((e) => [e.percent, e.dueDate])).toEqual([
      ["50", TODAY],
      ["50", "2026-10-07"],
    ]);
  });

  it("splits the percentages evenly as payments are added or removed, the new one due the day after the last", () => {
    const three = addEntry(defaultDraft(TODAY), 584.93);
    expect(three.entries.map((e) => e.percent)).toEqual(["33.33", "33.33", "33.34"]);
    expect(three.entries[2].dueDate).toBe("2026-10-08");
    expect(removeEntry(three, three.entries[2].key).entries.map((e) => e.percent)).toEqual(["50", "50"]);
  });

  it("gives a new $ payment what is still unscheduled", () => {
    const d: ScheduleDraft = {
      method: "amount",
      entries: [
        { key: "a", amount: "100", percent: "", dueDate: TODAY, note: "" },
        { key: "b", amount: "200", percent: "", dueDate: TODAY, note: "" },
      ],
    };
    expect(addEntry(d, 584.93).entries[2].amount).toBe("284.93");
  });

  it("stops at Workiz's 12 payments", () => {
    let d = defaultDraft(TODAY);
    while (canAddEntry(d)) d = addEntry(d, 1200);
    expect(d.entries).toHaveLength(MAX_SCHEDULED_PAYMENTS);
    expect(MAX_SCHEDULED_PAYMENTS).toBe(12);
    expect(addEntry(d, 1200).entries).toHaveLength(12);
  });

  it("shows the dollars billing will: $584.93 at 50/50 is $292.47 and $292.46", () => {
    expect(previewLines(defaultDraft(TODAY), 584.93, 0).map((l) => l.amount)).toEqual([292.47, 292.46]);
  });

  it("settles what is already paid on the payments in order", () => {
    expect(previewLines(defaultDraft(TODAY), 500, 300)).toEqual([
      { amount: 250, paid: 250, remaining: 0 },
      { amount: 250, paid: 50, remaining: 200 },
    ]);
  });

  it("switches % to $ and back, keeping the split", () => {
    const usd = switchMethod(defaultDraft(TODAY), "amount", 584.93);
    expect(usd.entries.map((e) => e.amount)).toEqual(["292.47", "292.46"]);
    expect(switchMethod(usd, "percent", 584.93).entries.map((e) => e.percent)).toEqual(["50", "50"]);
  });

  it("says what is wrong before saving, as billing would", () => {
    const d = defaultDraft(TODAY);
    expect(draftProblem(d, 100)).toBeNull();
    expect(draftProblem({ ...d, entries: [{ ...d.entries[0], percent: "40" }, d.entries[1]] }, 100)).toMatch(/100%/);
    expect(draftProblem({ ...d, entries: [{ ...d.entries[0], dueDate: "" }, d.entries[1]] }, 100)).toMatch(/Payment 1 needs a due date/);
    expect(draftProblem({ ...d, entries: [d.entries[0]] }, 100)).toMatch(/at least 2 payments/i);
    expect(draftProblem(d, 0)).toMatch(/items/i);
    const usd = switchMethod(d, "amount", 100);
    expect(draftProblem({ ...usd, entries: [{ ...usd.entries[0], amount: "10" }, usd.entries[1]] }, 100)).toBe(
      "The payments add up to $60.00 — they must make the job total, $100.00",
    );
  });

  it("sends the schedule as billing takes it, keeping the ids of payments it already had", () => {
    const d: ScheduleDraft = {
      method: "percent",
      entries: [
        { key: "p1", id: "p1", percent: "50", amount: "", dueDate: TODAY, note: " Deposit " },
        { key: "x", percent: "50", amount: "", dueDate: "2026-10-07", note: "" },
      ],
    };
    expect(toBody(d)).toEqual({
      method: "percent",
      entries: [
        { id: "p1", percent: 50, dueDate: TODAY, note: "Deposit" },
        { percent: 50, dueDate: "2026-10-07" },
      ],
    });
  });

  it("opens an existing schedule for editing", () => {
    const view: PaymentScheduleView = {
      dealId: "d1",
      method: "percent",
      total: 584.93,
      amountPaid: 0,
      balanceDue: 584.93,
      updatedAt: "",
      lines: [
        { id: "p1", index: 1, percent: 50, amount: 292.47, paid: 0, remaining: 292.47, dueDate: TODAY, status: "due" },
        { id: "p2", index: 2, percent: 50, amount: 292.46, paid: 0, remaining: 292.46, dueDate: "2026-10-07", note: "Rest", status: "future" },
      ],
    };
    expect(fromView(view).entries.map((e) => [e.id, e.percent, e.note])).toEqual([
      ["p1", "50", ""],
      ["p2", "50", "Rest"],
    ]);
  });
});

describe("payment schedule — the window's strip and the table's tags", () => {
  it("sums up the draft as Workiz's strip: Remaining, Job total, Next due, N payments", () => {
    expect(scheduleSummary(defaultDraft(TODAY), 500, 0)).toEqual({
      remaining: 500,
      total: 500,
      next: { amount: 250, dueDate: TODAY },
      paidCount: 0,
      count: 2,
    });
    expect(scheduleSummary(defaultDraft(TODAY), 500, 250)).toEqual({
      remaining: 250,
      total: 500,
      next: { amount: 250, dueDate: "2026-10-07" },
      paidCount: 1,
      count: 2,
    });
    expect(scheduleSummary(defaultDraft(TODAY), 500, 500).next).toBeNull();
  });

  it("tags a payment Paid, Partial, Overdue, Due or Future", () => {
    const line = (over: Partial<PaymentScheduleLine>): PaymentScheduleLine => ({
      id: "p", index: 1, amount: 100, paid: 0, remaining: 100, dueDate: TODAY, status: "future", ...over,
    });
    expect(scheduleStatus(line({ status: "paid", paid: 100, remaining: 0 })).label).toBe("Paid");
    expect(scheduleStatus(line({ status: "due", paid: 40, remaining: 60 })).label).toBe("Partial");
    expect(scheduleStatus(line({ status: "overdue" })).label).toBe("Overdue");
    expect(scheduleStatus(line({ status: "due" })).label).toBe("Due");
    expect(scheduleStatus(line({ status: "future" })).label).toBe("Future");
  });
});

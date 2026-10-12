import { describe, expect, it } from "vitest";
import { JobSuperStatus, TimelineEventType } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";
import { collapseReschedules, entryRowText, workizScheduleText, type WordingLookups } from "./timeline-wording";

const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
  id: "e1",
  dealId: "d1",
  eventType: TimelineEventType.FIELD_UPDATED,
  actorId: "u1",
  actorName: "Ann",
  timestamp: "2026-10-08T15:00:00.000Z",
  details: {},
  ...over,
});

const lk: WordingLookups = {
  userName: (id) => (id === "t1" ? "(2) TX - Daniel Munoz" : id === "t2" ? "Bo Diaz" : null),
  subStatuses: new Map([["ss-na", "NO ANSWER"]]),
  tags: new Map([
    ["tag-vip", "VIP"],
    ["tag-pl", "PLATINUM"],
  ]),
};

const text = (e: TimelineEntry, extra: Parameters<typeof entryRowText>[2] = {}) => entryRowText(e, lk, extra);

describe("timeline rows in Workiz's words (rail_history)", () => {
  it("an imported row reads exactly what Workiz wrote, on a laptop — or a phone when Workiz says it came from the app", () => {
    const imported = entry({
      details: { source: "workiz", workiz: { text: "Update job details", native: false, kind: "job_updated" } },
    });
    expect(text(imported)).toEqual({ lines: ["Update job details"], icon: "web" });

    const fromApp = entry({
      eventType: "workiz_activity" as TimelineEventType,
      note: "Viewed job in app",
      details: { source: "workiz", workiz: { text: "Viewed job in app", native: true } },
    });
    expect(text(fromApp)).toEqual({ lines: ["Viewed job in app"], icon: "mobile" });
  });

  it("an imported activity without a stamped text falls back to its note, never to 'Activity'", () => {
    const e = entry({ eventType: "workiz_activity" as TimelineEventType, note: "Added tag", details: { source: "workiz" } });
    expect(text(e).lines).toEqual(["Added tag"]);
  });

  it("Created Job", () => {
    expect(text(entry({ eventType: TimelineEventType.CREATED })).lines).toEqual(["Created Job"]);
  });

  it("Status Updated - Pending - NO ANSWER; a bare super-status keeps Workiz's trailing dash", () => {
    const withSub = entry({
      eventType: TimelineEventType.STATUS_CHANGED,
      details: { fromStatus: JobSuperStatus.SUBMITTED, toStatus: JobSuperStatus.PENDING, subStatusId: "ss-na" },
    });
    expect(text(withSub).lines).toEqual(["Status Updated - Pending - NO ANSWER"]);

    const bare = entry({
      eventType: TimelineEventType.STATUS_CHANGED,
      details: { fromStatus: JobSuperStatus.PENDING, toStatus: JobSuperStatus.SUBMITTED, subStatusId: null },
    });
    expect(text(bare).lines).toEqual(["Status Updated - Submitted - "]);
  });

  it("Tech Assigned / Tech Unassigned name the technician", () => {
    expect(text(entry({ eventType: TimelineEventType.TECH_ASSIGNED, details: { techId: "t1" } })).lines).toEqual([
      "Tech Assigned - (2) TX - Daniel Munoz",
    ]);
    expect(text(entry({ eventType: TimelineEventType.TECH_UNASSIGNED, details: { previousTechId: "t2" } })).lines).toEqual([
      "Tech Unassigned - Bo Diaz",
    ]);
  });

  it("a tag change is Workiz's 'Added tag' / 'Remove tag from job', naming the tags", () => {
    const added = entry({ details: { field: "tagIds", oldValue: ["tag-vip"], newValue: ["tag-vip", "tag-pl"] } });
    expect(text(added).lines).toEqual(["Added tag - PLATINUM"]);

    const removed = entry({ details: { field: "tagIds", oldValue: ["tag-vip", "tag-pl"], newValue: [] } });
    expect(text(removed).lines).toEqual(["Remove tag from job - VIP, PLATINUM"]);
  });

  it("any other field is 'Update job details', with what changed on the next line", () => {
    const e = entry({ details: { field: "priority", oldValue: "normal", newValue: "urgent" } });
    expect(text(e, { fieldDetail: () => "Priority: Normal → Urgent" }).lines).toEqual([
      "Update job details",
      "Priority: Normal → Urgent",
    ]);
    expect(text(e).lines).toEqual(["Update job details"]);
  });

  it("Sent to tech by SMS, with whom it went to", () => {
    const e = entry({ eventType: TimelineEventType.SENT_TO_TECH, details: { techIds: ["t2"], channels: ["sms", "in_app"] } });
    expect(text(e).lines).toEqual(["Sent to tech by SMS & In App - Bo Diaz"]);
  });

  it("what a technician does from the app shows the phone icon", () => {
    const seen = text(entry({ eventType: TimelineEventType.SEEN_BY_TECH, details: { techId: "t2" } }));
    expect(seen).toEqual({ lines: ["Viewed job in app"], icon: "mobile" });
    expect(text(entry({ eventType: TimelineEventType.TECH_ARRIVED, details: { techId: "t2" } })).icon).toBe("mobile");
  });

  it("files and items in Workiz's words", () => {
    expect(text(entry({ eventType: TimelineEventType.ATTACHMENT_ADDED, details: { fileName: "door.jpg" } })).lines).toEqual([
      "Saved Attachment - door.jpg",
    ]);
    expect(text(entry({ eventType: TimelineEventType.ATTACHMENT_REMOVED, details: { fileName: "door.jpg" } })).lines).toEqual([
      "Deleted Attachment - door.jpg",
    ]);
    expect(text(entry({ eventType: TimelineEventType.PRODUCT_ADDED, details: { productName: "Labor", priceClient: 125 } })).lines).toEqual([
      "Added item Labor (125.00)",
    ]);
    expect(text(entry({ eventType: TimelineEventType.PRODUCT_REMOVED, details: { productName: "Labor" } })).lines).toEqual([
      "Removed item Labor",
    ]);
    expect(text(entry({ eventType: TimelineEventType.PRODUCT_REMOVED, details: { productName: "Labor", priceClient: 125 } })).lines).toEqual([
      "Removed item Labor (125.00)",
    ]);
  });

  it("documents carry their numbers", () => {
    expect(text(entry({ eventType: TimelineEventType.ESTIMATE_CREATED, details: { number: "IQ3HPE-1" } })).lines).toEqual([
      "Created estimate #IQ3HPE-1",
    ]);
    expect(text(entry({ eventType: TimelineEventType.INVOICE_CREATED, details: { number: "OG69RO" } })).lines).toEqual([
      "Created invoice #OG69RO",
    ]);
    expect(text(entry({ eventType: TimelineEventType.ESTIMATE_SENT })).lines).toEqual(["Estimate Sent"]);
    expect(
      text(entry({ eventType: TimelineEventType.ESTIMATE_STATUS_CHANGED, details: { number: "IQ3HPE-1", to: "approved" } })).lines,
    ).toEqual(["Updated estimate IQ3HPE-1 status to Approved"]);
    expect(text(entry({ eventType: TimelineEventType.ESTIMATE_VIEWED, actorId: "client", details: { number: "K4-1" } })).lines).toEqual([
      "Client viewed estimate #K4-1",
    ]);
  });

  it("Added payment 231.36 in Credit charge", () => {
    const e = entry({ eventType: TimelineEventType.PAYMENT_RECEIVED, details: { amount: 231.36, method: "credit_charge" } });
    expect(text(e).lines).toEqual(["Added payment 231.36 in Credit charge"]);
  });

  it("a note is its own text, under the note icon", () => {
    expect(text(entry({ eventType: TimelineEventType.NOTE_ADDED, note: "Gate code 1234" }))).toEqual({
      lines: ["Gate code 1234"],
      icon: "note",
    });
  });

  it("an outgoing call reads 'Called <client>'; an incoming one is drawn with the incoming phone", () => {
    const out = text(
      entry({ eventType: TimelineEventType.CALL_LINKED, details: { direction: "outbound", to: "+14045551234", durationSeconds: 90 } }),
      { clientName: "Dustin Roselle" },
    );
    expect(out).toEqual({ lines: ["Called Dustin Roselle", "1:30"], icon: "call-out" });

    const inc = text(
      entry({ eventType: TimelineEventType.CALL_LINKED, details: { direction: "inbound", from: "+14045551234", durationSeconds: 272, hasRecording: true } }),
      { clientName: "Dustin Roselle" },
    );
    expect(inc).toEqual({ lines: ["Call from Dustin Roselle", "4:32 · recorded"], icon: "call-in" });
  });

  it("a reschedule worked out by collapseReschedules wins over the field line", () => {
    const e = entry({ details: { field: "scheduledDate", oldValue: "2026-10-07", newValue: "2026-10-08" } });
    expect(text(e, { reschedule: "Rescheduled job from A to B" }).lines).toEqual(["Rescheduled job from A to B"]);
  });
});

describe("workizScheduleText — 'Thu Oct 08 2026 6:00 pm - 7:00 pm'", () => {
  it("writes a timed visit the way Workiz's activity log does", () => {
    expect(workizScheduleText({ date: "2026-10-08", slot: "18:00-19:00" })).toBe("Thu Oct 08 2026 6:00 pm - 7:00 pm");
    expect(workizScheduleText({ date: "2026-10-07", slot: "08:30-09:00" })).toBe("Wed Oct 07 2026 8:30 am - 9:00 am");
    expect(workizScheduleText({ date: "2026-10-07", slot: "12:00-00:00" })).toBe("Wed Oct 07 2026 12:00 pm - 12:00 am");
  });

  it("an all-day or untimed visit is the day alone; no day at all is Unscheduled", () => {
    expect(workizScheduleText({ date: "2026-10-08", allDay: true, slot: "18:00-19:00" })).toBe("Thu Oct 08 2026");
    expect(workizScheduleText({ date: "2026-10-08" })).toBe("Thu Oct 08 2026");
    expect(workizScheduleText({})).toBe("Unscheduled");
  });
});

describe("collapseReschedules — one 'Rescheduled job from … to …' per save", () => {
  const field = (id: string, at: string, f: string, oldValue: unknown, newValue: unknown, actorId = "u1") =>
    entry({ id, timestamp: at, actorId, details: { field: f, oldValue, newValue } });

  it("folds the fields one save logged into the newest of them, reading the times back from the job as it is now", () => {
    const entries = [
      field("a", "2026-10-08T15:00:01.000Z", "scheduledTimeSlot", "08:30-09:00", "18:00-19:00"),
      field("b", "2026-10-08T15:00:00.500Z", "scheduledDate", "2026-10-07", "2026-10-08"),
      // An earlier save that moved only the time, the day staying put.
      field("c", "2026-10-07T12:00:00.000Z", "scheduledTimeSlot", "08:00-09:00", "08:30-09:00"),
    ];
    const out = collapseReschedules(entries, { date: "2026-10-08", slot: "18:00-19:00" });

    expect([...out.hidden]).toEqual(["b"]);
    expect(out.text.get("a")).toBe("Rescheduled job from Wed Oct 07 2026 8:30 am - 9:00 am to Thu Oct 08 2026 6:00 pm - 7:00 pm");
    expect(out.text.get("c")).toBe("Rescheduled job from Wed Oct 07 2026 8:00 am - 9:00 am to Wed Oct 07 2026 8:30 am - 9:00 am");
  });

  it("keeps two people's saves apart, and leaves imported rows (Workiz already wrote them) alone", () => {
    const imported = entry({
      id: "w",
      timestamp: "2026-10-01T10:00:00.000Z",
      details: { field: "scheduledDate", oldValue: "2026-09-30T10:30:00-04:00", newValue: "2026-10-01T10:30:00-04:00", source: "workiz", workiz: { text: "Rescheduled job from X to Y" } },
    });
    const entries = [
      field("a", "2026-10-08T15:00:01.000Z", "scheduledTimeSlot", "08:00-09:00", "09:00-10:00", "u1"),
      field("b", "2026-10-08T15:00:00.000Z", "scheduledDate", "2026-10-07", "2026-10-08", "u2"),
      imported,
    ];
    const out = collapseReschedules(entries, { date: "2026-10-08", slot: "09:00-10:00" });

    expect(out.hidden.size).toBe(0);
    expect(out.text.get("a")).toBe("Rescheduled job from Thu Oct 08 2026 8:00 am - 9:00 am to Thu Oct 08 2026 9:00 am - 10:00 am");
    expect(out.text.get("b")).toBe("Rescheduled job from Wed Oct 07 2026 8:00 am - 9:00 am to Thu Oct 08 2026 8:00 am - 9:00 am");
    expect(out.text.has("w")).toBe(false);
  });

  it("without the job's visit to read back from, a save is worded from its own values", () => {
    const entries = [
      field("a", "2026-10-08T15:00:01.000Z", "scheduledTimeSlot", "08:00-09:00", "18:00-19:00"),
      field("b", "2026-10-08T15:00:00.000Z", "scheduledDate", "2026-10-07", "2026-10-08"),
    ];
    const out = collapseReschedules(entries, null);
    expect(out.text.get("a")).toBe("Rescheduled job from Wed Oct 07 2026 8:00 am - 9:00 am to Thu Oct 08 2026 6:00 pm - 7:00 pm");
  });

  it("an unscheduled job reads Unscheduled on the empty side", () => {
    const entries = [field("a", "2026-10-08T15:00:00.000Z", "scheduledDate", null, "2026-10-08")];
    const out = collapseReschedules(entries, { date: "2026-10-08" });
    expect(out.text.get("a")).toBe("Rescheduled job from Unscheduled to Thu Oct 08 2026");
  });
});

/**
 * C8 (2026-10-12): the rest of Workiz's sentences, read off its activity log
 * (data/raw/activity.jsonl, 2025–2026) and the job's Timeline (job_b_03_rail0),
 * worded the same as Reports → Activity (`nativeActivityText`).
 */
describe("timeline rows — the rest of Workiz's sentences (C8)", () => {
  it("Status Updated spells the status the way Workiz's log does, and says why a job was canceled", () => {
    const status = (details: Record<string, unknown>) => text(entry({ eventType: TimelineEventType.STATUS_CHANGED, details })).lines;
    expect(status({ toStatus: JobSuperStatus.IN_PROGRESS, subStatusName: "Job Accepted" })).toEqual([
      "Status Updated - In progress - Job Accepted",
    ]);
    expect(status({ toStatus: JobSuperStatus.DONE_PENDING_APPROVAL, subStatusName: "CHEQUE" })).toEqual([
      "Status Updated - done pending approval - CHEQUE",
    ]);
    expect(status({ toStatus: JobSuperStatus.CANCELED, subStatusName: "Cant Do", cancellationReason: "tech said cant do" })).toEqual([
      "Status Updated - Canceled - Cant Do - tech said cant do",
    ]);
    // A Canceled sub-status is the reason when none was typed — said once.
    expect(status({ toStatus: JobSuperStatus.CANCELED, subStatusName: "Out of area", cancellationReason: "Out of area" })).toEqual([
      "Status Updated - Canceled - Out of area",
    ]);
    // The catalog's name when the entry was written without one.
    expect(status({ toStatus: JobSuperStatus.PENDING, subStatusId: "ss-na" })).toEqual(["Status Updated - Pending - NO ANSWER"]);
  });

  it("names the technician as written with the event when the directory does not know them", () => {
    const e = entry({ eventType: TimelineEventType.TECH_ASSIGNED, details: { techId: "t-gone", techName: "(3) IL - Elias Yamal SUB" } });
    expect(text(e).lines).toEqual(["Tech Assigned - (3) IL - Elias Yamal SUB"]);
  });

  it("tags: 'Added tag(s)' for several at once, 'Updated tags' when some come and some go", () => {
    const several = entry({ details: { field: "tagIds", oldValue: [], newValue: ["tag-vip", "tag-pl"] } });
    expect(text(several).lines).toEqual(["Added tag(s) - VIP, PLATINUM"]);

    const both = entry({ details: { field: "tagIds", oldValue: ["tag-vip"], newValue: ["tag-pl"] } });
    expect(text(both).lines).toEqual(["Updated tags", "Added tag - PLATINUM", "Remove tag from job - VIP"]);
  });

  it("Job name changed, with the names on the next line", () => {
    const e = entry({ details: { field: "jobName", oldValue: null, newValue: "Back gate" } });
    expect(text(e, { fieldDetail: () => "Job name: — → Back gate" }).lines).toEqual(["Job name changed", "Job name: — → Back gate"]);
  });

  it("Payment status updated - Paid", () => {
    const e = entry({ details: { field: "paymentStatus", newValue: "paid", amountPaid: 120 } });
    expect(text(e).lines).toEqual(["Payment status updated - Paid"]);
  });

  it("a reschedule saved as one entry is Workiz's one sentence", () => {
    const e = entry({
      details: {
        field: "schedule",
        oldValue: { date: "2026-10-07", endDate: "2026-10-07", slot: "17:00-18:00", allDay: null },
        newValue: { date: "2026-10-08", endDate: "2026-10-08", slot: "08:00-09:00", allDay: null },
      },
    });
    expect(text(e).lines).toEqual([
      "Rescheduled job from Wed Oct 07 2026 5:00 pm - 6:00 pm to Thu Oct 08 2026 8:00 am - 9:00 am",
    ]);
  });

  it("an item's new price is 'Item price updated: <item> — 45.00 → 35.00'; any other item edit is 'Update job details'", () => {
    const price = entry({
      eventType: TimelineEventType.PRODUCT_UPDATED,
      details: { productName: "Service Call", changes: { priceClient: { from: 45, to: 35 } } },
    });
    expect(text(price).lines).toEqual(["Item price updated: Service Call — 45.00 → 35.00"]);

    const qty = entry({
      eventType: TimelineEventType.PRODUCT_UPDATED,
      details: { productName: "Parts", changes: { quantity: { from: 1, to: 2 }, costCompany: { from: 10, to: 12 } } },
    });
    expect(text(qty).lines).toEqual(["Update job details", "Parts — Qty: 1 → 2", "Parts — Cost (company): 10.00 → 12.00"]);

    const renamed = entry({
      eventType: TimelineEventType.PRODUCT_UPDATED,
      details: { productName: "Deadbolt", previousProductName: "Lock", changes: {} },
    });
    expect(text(renamed).lines).toEqual(["Update job details", "Item: Lock → Deadbolt"]);
  });

  it("payments in Workiz's words: a card is a Credit charge; a refund is a charge refunded; a deleted one names its kind", () => {
    const pay = (eventType: TimelineEventType, details: Record<string, unknown>) => text(entry({ eventType, details })).lines;
    expect(pay(TimelineEventType.PAYMENT_RECEIVED, { amount: 295.48, method: "card" })).toEqual(["Added payment 295.48 in Credit charge"]);
    expect(pay(TimelineEventType.PAYMENT_RECEIVED, { amount: 72, method: "cash" })).toEqual(["Added payment 72.00 in Cash"]);
    expect(pay(TimelineEventType.PAYMENT_REFUNDED, { amount: 109.54, method: "card", refundId: "r1" })).toEqual(["Refunded payment 109.54 charge"]);
    expect(pay(TimelineEventType.PAYMENT_REFUNDED, { amount: 433, method: "cash", deleted: true })).toEqual(["Deleted payment 433 cash"]);
    expect(pay(TimelineEventType.PAYMENT_REFUNDED, { amount: 1600, method: "card", deleted: true })).toEqual(["Deleted payment 1600 credit"]);
  });

  it("an estimate signed is 'Client signed estimate'; a status without a number reads as Activity does", () => {
    expect(
      text(entry({ eventType: TimelineEventType.ESTIMATE_STATUS_CHANGED, details: { number: "8HNU0Y-6", signed: true } })).lines,
    ).toEqual(["Client signed estimate"]);
    expect(text(entry({ eventType: TimelineEventType.ESTIMATE_STATUS_CHANGED, details: { to: "declined" } })).lines).toEqual([
      "Estimate status updated - Declined",
    ]);
  });

  it("an invoice signature is the client's, whoever held the phone (Workiz: 'Client signed invoice')", () => {
    const e = entry({ eventType: TimelineEventType.INVOICE_SIGNED, actorId: "u-tech", details: { number: "O8E9NQ" } });
    expect(text(e).lines).toEqual(["Client signed invoice #O8E9NQ"]);
  });
});

describe("collapseReschedules — with reschedules saved as one entry", () => {
  it("words the one-entry save from its own values and reads the older per-field saves back from it", () => {
    const entries = [
      entry({
        id: "a",
        timestamp: "2026-10-08T15:00:00.000Z",
        details: {
          field: "schedule",
          oldValue: { date: "2026-10-07", slot: "08:30-09:00" },
          newValue: { date: "2026-10-08", slot: "18:00-19:00" },
        },
      }),
      // Written before the one-entry saves: the time alone, per field.
      entry({ id: "c", timestamp: "2026-10-07T12:00:00.000Z", details: { field: "scheduledTimeSlot", oldValue: "08:00-09:00", newValue: "08:30-09:00" } }),
    ];
    const out = collapseReschedules(entries, { date: "2026-10-08", slot: "18:00-19:00" });

    expect(out.hidden.size).toBe(0);
    expect(out.text.get("a")).toBe("Rescheduled job from Wed Oct 07 2026 8:30 am - 9:00 am to Thu Oct 08 2026 6:00 pm - 7:00 pm");
    expect(out.text.get("c")).toBe("Rescheduled job from Wed Oct 07 2026 8:00 am - 9:00 am to Wed Oct 07 2026 8:30 am - 9:00 am");
  });
});

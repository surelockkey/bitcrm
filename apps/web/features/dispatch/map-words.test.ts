import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";

import { jobCardTitle, lastSeenText, lastUpdatedText, mapAddress, mapStatusWord, pinCardWhen } from "./map-words";

describe("jobCardTitle", () => {
  // "Car Key Copy - Job #A4IC4E" (pg_dispatch_wz_02_loaded).
  it("is the job type, a dash and the job id", () => {
    expect(jobCardTitle("Car Key Copy", "A4IC4E")).toBe("Car Key Copy - Job #A4IC4E");
    // Workiz's own names carry stray spaces; the page prints them collapsed.
    expect(jobCardTitle("Car Key Copy  ", "A4IC4E")).toBe("Car Key Copy - Job #A4IC4E");
  });

  it("is just the job id for a job without a type", () => {
    expect(jobCardTitle("—", "A4IC4E")).toBe("Job #A4IC4E");
    expect(jobCardTitle("", "A4IC4E")).toBe("Job #A4IC4E");
  });
});

describe("mapAddress", () => {
  it("spells the state out: street, city, state, zip", () => {
    expect(mapAddress({ street: "301 Humphrey St", city: "New Haven", state: "CT", zip: "06511" })).toBe(
      "301 Humphrey St, New Haven, Connecticut, 06511",
    );
  });

  it("keeps the unit with the street and leaves out what is missing", () => {
    expect(mapAddress({ street: "2010 Huntington Turnpike", unit: "#suite 6", city: "Trumbull", state: "CT", zip: "06611" })).toBe(
      "2010 Huntington Turnpike #suite 6, Trumbull, Connecticut, 06611",
    );
    expect(mapAddress({ street: "15734 Bending Birch Dr", city: "", state: "TX", zip: "77433" })).toBe(
      "15734 Bending Birch Dr, Texas, 77433",
    );
  });

  it("prints a state it does not know as given", () => {
    expect(mapAddress({ street: "1 King St", city: "Toronto", state: "ON", zip: "M5H" })).toBe("1 King St, Toronto, ON, M5H");
  });
});

describe("pinCardWhen", () => {
  // "Fri Oct 09 7:30 am - 8:30 am" (pg_dispatch_wz_05_pin_click) — and, ours
  // since 2026-10-12 (owner rule), on Connecticut's clock with its zone after it.
  it("is the day and the slot, as Workiz's card prints it, labelled", () => {
    expect(pinCardWhen({ scheduledDate: "2026-10-09", scheduledTimeSlot: "07:30-08:30" })).toBe("Fri Oct 09 7:30 am - 8:30 am EDT");
    expect(pinCardWhen({ scheduledDate: "2026-10-10", scheduledTimeSlot: "21:00-23:00" })).toBe("Sat Oct 10 9:00 pm - 11:00 pm EDT");
    expect(pinCardWhen({ scheduledDate: "2026-10-10", scheduledTimeSlot: "12:00-12:30" })).toBe("Sat Oct 10 12:00 pm - 12:30 pm EDT");
    expect(pinCardWhen({ scheduledDate: "2026-12-01", scheduledTimeSlot: "09:00-10:00" })).toBe("Tue Dec 01 9:00 am - 10:00 am EST");
  });

  it("names the end day when the job runs past its start day", () => {
    expect(
      pinCardWhen({ scheduledDate: "2026-10-09", scheduledEndDate: "2026-10-10", scheduledTimeSlot: "22:00-01:00" }),
    ).toBe("Fri Oct 09 10:00 pm - Sat Oct 10 1:00 am EDT");
  });

  it("moves a visit booked on another zone's clock onto Connecticut's", () => {
    // Texas, 10:00 CDT = 11:00 EDT.
    expect(pinCardWhen({ scheduledDate: "2026-10-12", scheduledTimeSlot: "10:00-11:00" }, "America/Chicago")).toBe(
      "Mon Oct 12 11:00 am - 12:00 pm EDT",
    );
    // Arizona, 22:00 MST = 01:00 EDT the next day.
    expect(pinCardWhen({ scheduledDate: "2026-10-12", scheduledTimeSlot: "22:00-23:00" }, "America/Phoenix")).toBe(
      "Tue Oct 13 1:00 am - 2:00 am EDT",
    );
    // Texas 22:30-23:30 runs past Connecticut's midnight: the end day is named.
    expect(pinCardWhen({ scheduledDate: "2026-10-12", scheduledTimeSlot: "22:30-23:30" }, "America/Chicago")).toBe(
      "Mon Oct 12 11:30 pm - Tue Oct 13 12:30 am EDT",
    );
  });

  it("is the day alone without a time, and nothing without a day", () => {
    expect(pinCardWhen({ scheduledDate: "2026-10-09", allDay: true }, "America/Phoenix")).toBe("Fri Oct 09");
    expect(pinCardWhen({ scheduledDate: "2026-10-09", allDay: true })).toBe("Fri Oct 09");
    expect(pinCardWhen({ scheduledDate: "2026-10-09" })).toBe("Fri Oct 09");
    expect(pinCardWhen({})).toBe("");
  });
});

describe("mapStatusWord", () => {
  // The Map's status words (its tags and the Filters' Status list).
  it("uses Workiz's words for the open statuses", () => {
    expect(mapStatusWord(JobSuperStatus.SUBMITTED)).toBe("Submitted");
    expect(mapStatusWord(JobSuperStatus.IN_PROGRESS)).toBe("In progress");
    expect(mapStatusWord(JobSuperStatus.PENDING)).toBe("Pending");
    expect(mapStatusWord(JobSuperStatus.DONE_PENDING_APPROVAL)).toBe("done pending approval");
  });
});

describe("lastSeenText", () => {
  // "Thu Oct 08 2026 7:03 pm" (pg_dispatch_wz_13_tech_click) — on Connecticut's
  // clock and labelled (2026-10-12 owner rule), not the viewer's browser's.
  it("prints the fix's time the way the tech card does, in Connecticut", () => {
    expect(lastSeenText("2026-10-08T23:03:00Z")).toBe("Thu Oct 08 2026 7:03 pm EDT");
    // 04:25Z is just past Connecticut's midnight (07:25 in Kyiv).
    expect(lastSeenText("2026-10-09T04:25:00Z")).toBe("Fri Oct 09 2026 12:25 am EDT");
    // 03:30Z on the 9th is still the 8th in Connecticut.
    expect(lastSeenText("2026-10-09T03:30:00Z")).toBe("Thu Oct 08 2026 11:30 pm EDT");
    expect(lastSeenText("2026-12-01T15:00:00Z")).toBe("Tue Dec 01 2026 10:00 am EST");
  });
});

describe("lastUpdatedText", () => {
  // The refresh button's tooltip: when the board last came in, in Connecticut.
  it("is the time with its seconds and the zone", () => {
    expect(lastUpdatedText(Date.parse("2026-10-12T19:08:12Z"))).toBe("Last updated 3:08:12 PM EDT");
    expect(lastUpdatedText(Date.parse("2026-12-01T15:00:05Z"))).toBe("Last updated 10:00:05 AM EST");
  });
});

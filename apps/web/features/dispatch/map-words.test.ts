import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";

import { jobCardTitle, lastSeenText, mapAddress, mapStatusWord, pinCardWhen } from "./map-words";

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
  // "Fri Oct 09 7:30 am - 8:30 am" (pg_dispatch_wz_05_pin_click).
  it("is the day and the slot, as Workiz's card prints it", () => {
    expect(pinCardWhen({ scheduledDate: "2026-10-09", scheduledTimeSlot: "07:30-08:30" })).toBe("Fri Oct 09 7:30 am - 8:30 am");
    expect(pinCardWhen({ scheduledDate: "2026-10-10", scheduledTimeSlot: "21:00-23:00" })).toBe("Sat Oct 10 9:00 pm - 11:00 pm");
    expect(pinCardWhen({ scheduledDate: "2026-10-10", scheduledTimeSlot: "12:00-12:30" })).toBe("Sat Oct 10 12:00 pm - 12:30 pm");
  });

  it("names the end day when the job runs past its start day", () => {
    expect(
      pinCardWhen({ scheduledDate: "2026-10-09", scheduledEndDate: "2026-10-10", scheduledTimeSlot: "22:00-01:00" }),
    ).toBe("Fri Oct 09 10:00 pm - Sat Oct 10 1:00 am");
  });

  it("is the day alone without a time, and nothing without a day", () => {
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
  // "Thu Oct 08 2026 7:03 pm" (pg_dispatch_wz_13_tech_click), in the viewer's time.
  it("prints the fix's time the way the tech card does", () => {
    const at = new Date(2026, 9, 8, 19, 3).toISOString();
    expect(lastSeenText(at)).toBe("Thu Oct 08 2026 7:03 pm");
    expect(lastSeenText(new Date(2026, 9, 9, 0, 25).toISOString())).toBe("Fri Oct 09 2026 12:25 am");
  });
});

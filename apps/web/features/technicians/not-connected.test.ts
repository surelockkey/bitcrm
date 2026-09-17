import { describe, it, expect } from "vitest";
import {
  allNotConnected,
  AVAILABILITY_NOT_CONNECTED,
  NOT_CONNECTED_BANNER,
  PERSON_NOT_CONNECTED,
  SETTINGS_NOT_CONNECTED,
  WORK_NOT_CONNECTED,
} from "./not-connected";

describe("the Workiz fields we draw dead", () => {
  it("covers every field the parity doc lists as theirs and not ours", () => {
    // WORKIZ_USER_PAGE_PARITY.md §1, minus the two it records as covered:
    // the phone country code (our phone control carries it) and the working
    // hours toggle's partner, the hours themselves, which are live.
    expect(allNotConnected().map((f) => f.key).sort()).toEqual(
      [
        "additional-phones",
        "allowed-ips",
        "availability-same-as-business",
        "field-team-member",
        "notes",
        "notify-incoming-messages",
        "notify-outgoing-messages",
        "notify-sms-all-numbers",
        "schedule-color",
        "sync-email",
        "two-factor",
        "user-signature",
        "user-skills",
        "user-type",
      ].sort(),
    );
  });

  it("gives every one of them a label and a line saying why it is dead", () => {
    for (const field of allNotConnected()) {
      expect(field.label.trim().length).toBeGreaterThan(0);
      expect(field.note.trim().length).toBeGreaterThan(0);
      expect(field.note).not.toBe(field.label);
    }
  });

  it("names each field once", () => {
    const keys = allNotConnected().map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries no value, ever — the spec has nowhere to put one", () => {
    for (const field of allNotConnected()) {
      expect(Object.keys(field).sort()).toEqual(["key", "kind", "label", "note"]);
    }
  });

  it("keeps the availability toggle out of the dead-settings block, above the live hours", () => {
    expect(SETTINGS_NOT_CONNECTED).not.toContain(AVAILABILITY_NOT_CONNECTED);
    expect(AVAILABILITY_NOT_CONNECTED.note).toMatch(/hours below/);
  });

  it("holds the settings block in Workiz's order", () => {
    expect(SETTINGS_NOT_CONNECTED.map((f) => f.key)).toEqual([
      "sync-email",
      "allowed-ips",
      "notify-sms-all-numbers",
      "notify-incoming-messages",
      "notify-outgoing-messages",
      "user-signature",
    ]);
  });

  it("says once, at the top of that block, that nothing in it saves", () => {
    expect(NOT_CONNECTED_BANNER).toMatch(/nothing/i);
    expect(NOT_CONNECTED_BANNER).toMatch(/save/i);
  });

  it("keeps Workiz's own labels for the fields the owner will look for", () => {
    expect(PERSON_NOT_CONNECTED.userType.label).toBe("User type");
    expect(WORK_NOT_CONNECTED.fieldTeamMember.label).toBe("Field team member");
    expect(WORK_NOT_CONNECTED.userSkills.label).toBe("User skills");
    expect(WORK_NOT_CONNECTED.scheduleColor.label).toBe("Schedule color");
  });
});

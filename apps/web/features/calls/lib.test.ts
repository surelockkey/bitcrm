import { describe, it, expect } from "vitest";
import {
  callParty,
  counterparty,
  filterToParams,
  isInternalCall,
  otherPartyNumber,
  formatCallTime,
  formatDuration,
  formatEndpoint,
  isLive,
  statusTone,
} from "./lib";

describe("isLive", () => {
  it("treats non-terminal statuses as live", () => {
    expect(isLive({ status: "ringing" })).toBe(true);
    expect(isLive({ status: "in-progress" })).toBe(true);
    expect(isLive({ status: "completed" })).toBe(false);
    expect(isLive({ status: "no-answer" })).toBe(false);
    expect(isLive({})).toBe(false);
  });
});

describe("statusTone", () => {
  it("maps statuses to their badge tone", () => {
    expect(statusTone("in-progress")).toBe("live");
    expect(statusTone("completed")).toBe("neutral");
    expect(statusTone("busy")).toBe("warn");
    expect(statusTone("no-answer")).toBe("warn");
    expect(statusTone("failed")).toBe("error");
    expect(statusTone(undefined)).toBe("neutral");
  });
});

describe("formatDuration", () => {
  it("formats sub-hour as m:ss and above as h:mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
  it("dashes out missing values", () => {
    expect(formatDuration(undefined)).toBe("—");
  });
});

describe("formatCallTime", () => {
  it("renders a readable timestamp and dashes invalid input", () => {
    expect(formatCallTime("2026-08-05T14:41:00.000Z")).toMatch(/Aug 5/);
    expect(formatCallTime("garbage")).toBe("—");
    expect(formatCallTime(undefined)).toBe("—");
  });
});

describe("formatEndpoint", () => {
  it("formats numbers internationally, labels agent legs, dashes blanks", () => {
    expect(formatEndpoint("+12624061115")).toBe("+1 262 406 1115");
    // NO national prefix: "+380 095…" would read as an extra digit.
    expect(formatEndpoint("+380958601427")).toBe("+380 95 860 1427");
    expect(formatEndpoint("client:d47814b8-e051-706e")).toBe("Agent");
    expect(formatEndpoint(undefined)).toBe("—");
    expect(formatEndpoint("")).toBe("—");
  });
});

describe("otherPartyNumber", () => {
  it("returns the far-side endpoint per direction", () => {
    expect(
      otherPartyNumber({ direction: "inbound", from: "+38095", to: "+1262" }),
    ).toBe("+38095");
    expect(
      otherPartyNumber({ direction: "outbound", from: "+1262", to: "+38095" }),
    ).toBe("+38095");
  });

  it("skips legacy client: endpoints when the other side is a real number", () => {
    expect(
      otherPartyNumber({
        direction: "outbound",
        from: "+38095",
        to: "client:abc",
      }),
    ).toBe("+38095");
  });
});

/**
 * The precedence between softphone participant, personal number and CRM
 * record now lives server-side (telephony's party-resolver), so these cover
 * only the mapping of that answer onto what the UI renders.
 */
describe("callParty", () => {
  const base = {
    callSid: "CA1",
    startedAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z",
    from: "+12624061115",
    to: "+380958601427",
  };

  it("renders the party the backend resolved", () => {
    const call = {
      ...base,
      fromParty: {
        kind: "user" as const,
        id: "u1",
        name: "Nazarii",
        roleId: "role-dispatcher",
      },
      toParty: { kind: "contact" as const, id: "c1", name: "Jane Roe" },
    };
    expect(callParty(call, "from")).toEqual({
      kind: "user",
      id: "u1",
      name: "Nazarii",
      roleId: "role-dispatcher",
      number: "+12624061115",
    });
    expect(callParty(call, "to").kind).toBe("contact");
  });

  it("falls back to an unknown party carrying the number", () => {
    // What an un-enriched record looks like — the CRM being unreachable must
    // still leave something dialable on screen, and "Add client" needs it.
    expect(callParty(base, "to")).toEqual({
      kind: "unknown",
      number: "+380958601427",
    });
  });

  it("keeps the personal-number marker", () => {
    const call = {
      ...base,
      toParty: {
        kind: "user" as const,
        id: "u9",
        name: "Tamir Levi",
        personal: true,
      },
    };
    expect(callParty(call, "to").personal).toBe(true);
  });
});

describe("counterparty", () => {
  const base = {
    callSid: "CA1",
    startedAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z",
  };

  it("returns the side that isn't us", () => {
    expect(
      counterparty({
        ...base,
        fromParty: { kind: "user", id: "u1", name: "Nazarii" },
        toParty: { kind: "contact", id: "c1", name: "Jane Roe" },
      }).name,
    ).toBe("Jane Roe");

    expect(
      counterparty({
        ...base,
        fromParty: { kind: "contact", id: "c1", name: "Jane Roe" },
        toParty: { kind: "user", id: "u1", name: "Nazarii" },
      }).name,
    ).toBe("Jane Roe");
  });

  it("on an internal call, the far end is the answerer", () => {
    const call = {
      ...base,
      fromParty: { kind: "user" as const, id: "u1", name: "Nazarii" },
      toParty: { kind: "user" as const, id: "u2", name: "Tamir" },
    };
    expect(isInternalCall(call)).toBe(true);
    expect(counterparty(call).name).toBe("Tamir");
  });

  it("is unknown when nothing resolved", () => {
    expect(counterparty({ ...base, from: "+38095" }).kind).toBe("unknown");
  });
});

describe("filterToParams", () => {
  it("joins a client's phone list into one comma-separated param", () => {
    const qs = filterToParams({ numbers: ["+1262", "+1541"] });
    expect(qs.get("numbers")).toBe("+1262,+1541");
    // An empty list must not become `numbers=` — that would match everything.
    expect(filterToParams({ numbers: [] }).has("numbers")).toBe(false);
  });

  it("keeps set values, drops empties, appends cursor and limit", () => {
    const qs = filterToParams(
      { direction: "inbound", status: "", number: "404" },
      "cur1",
      25,
    );
    expect(qs.get("direction")).toBe("inbound");
    expect(qs.get("status")).toBeNull();
    expect(qs.get("number")).toBe("404");
    expect(qs.get("cursor")).toBe("cur1");
    expect(qs.get("limit")).toBe("25");
  });
});

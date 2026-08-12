import { describe, it, expect } from "vitest";
import {
  callParty,
  callUsers,
  filterToParams,
  formatCallTime,
  formatDuration,
  formatEndpoint,
  isLive,
  otherParty,
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

describe("otherParty", () => {
  it("returns the customer side per direction", () => {
    expect(
      otherParty({ direction: "inbound", from: "+38095", to: "+1262" }),
    ).toBe("+38095");
    expect(
      otherParty({ direction: "outbound", from: "+1262", to: "+38095" }),
    ).toBe("+38095");
  });
  it("skips legacy client: endpoints when the other side is a real number", () => {
    expect(
      otherParty({ direction: "outbound", from: "+38095", to: "client:abc" }),
    ).toBe("+38095");
  });
});

describe("callUsers", () => {
  const base = {
    callSid: "CA1",
    startedAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z",
  };

  it("shows the caller for outbound and the answerer for inbound", () => {
    expect(
      callUsers({
        ...base,
        participants: [
          { userId: "u1", role: "caller", at: "", name: "Nazarii" },
        ],
      }),
    ).toBe("Nazarii");
    expect(
      callUsers({
        ...base,
        participants: [
          { userId: "u2", role: "answered", at: "", name: "Tamir" },
        ],
      }),
    ).toBe("Tamir");
  });

  it("shows caller → answerer for internal calls", () => {
    expect(
      callUsers({
        ...base,
        participants: [
          { userId: "u1", role: "caller", at: "", name: "Nazarii" },
          { userId: "u2", role: "answered", at: "", name: "Tamir" },
        ],
      }),
    ).toBe("Nazarii → Tamir");
  });

  it("falls back to agentName, then a short id, then a dash", () => {
    expect(callUsers({ ...base, agentName: "Nazarii" })).toBe("Nazarii");
    expect(
      callUsers({ ...base, agentId: "d47814b8-e051-706e" }),
    ).toBe("d47814b8…");
    expect(callUsers(base)).toBe("—");
  });
});

describe("callParty", () => {
  const base = {
    callSid: "CA1",
    startedAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z",
  };

  it("puts the dialling user on `from` for outbound calls", () => {
    const call = {
      ...base,
      direction: "outbound" as const,
      from: "+12624061115",
      to: "+380958601427",
      participants: [
        { userId: "u1", role: "caller" as const, at: "", name: "Nazarii" },
      ],
    };
    expect(callParty(call, "from")).toEqual({
      kind: "user",
      userId: "u1",
      roleId: undefined,
      label: "Nazarii",
      number: "+12624061115",
    });
    // The customer side is nobody we know until the CRM says otherwise.
    expect(callParty(call, "to")).toEqual({
      kind: "unknown",
      number: "+380958601427",
    });
  });

  it("puts the answering user on `to` for inbound calls", () => {
    const call = {
      ...base,
      direction: "inbound" as const,
      from: "+380958601427",
      to: "+12624061115",
      participants: [
        { userId: "u2", role: "answered" as const, at: "", name: "Tamir" },
      ],
    };
    expect(callParty(call, "from")).toEqual({
      kind: "unknown",
      number: "+380958601427",
    });
    expect(callParty(call, "to")).toEqual({
      kind: "user",
      userId: "u2",
      roleId: undefined,
      label: "Tamir",
      number: "+12624061115",
    });
  });

  it("names the outside party from the CRM contact when there is one", () => {
    const call = {
      ...base,
      direction: "inbound" as const,
      from: "+380958601427",
      to: "+12624061115",
      fromContact: { id: "c1", name: "Jane Roe" },
      participants: [
        { userId: "u2", role: "answered" as const, at: "", name: "Tamir" },
      ],
    };
    expect(callParty(call, "from")).toEqual({
      kind: "contact",
      contactId: "c1",
      label: "Jane Roe",
      number: "+380958601427",
    });
    // Our own side is still the user, never the contact.
    expect(callParty(call, "to").kind).toBe("user");
  });

  it("recognises one of our own reached on their personal number", () => {
    const call = {
      ...base,
      direction: "outbound" as const,
      from: "+12624061115",
      to: "+15412830739",
      toPersonal: { id: "u9", name: "Tamir Levi", roleId: "role-technician" },
      participants: [
        { userId: "u1", role: "caller" as const, at: "", name: "Nazarii" },
      ],
    };
    expect(callParty(call, "to")).toEqual({
      kind: "user",
      userId: "u9",
      roleId: "role-technician",
      personal: true,
      label: "Tamir Levi",
      number: "+15412830739",
    });
  });

  it("prefers the softphone participant over a personal-number match", () => {
    const call = {
      ...base,
      direction: "inbound" as const,
      from: "+380958601427",
      to: "+12624061115",
      toPersonal: { id: "u9", name: "Tamir Levi" },
      participants: [
        { userId: "u2", role: "answered" as const, at: "", name: "Tamir" },
      ],
    };
    // They answered at their desk — not a call to their mobile.
    const party = callParty(call, "to");
    expect(party.userId).toBe("u2");
    expect(party.personal).toBeUndefined();
  });

  it("carries the role through so the UI can mark our own people", () => {
    const call = {
      ...base,
      direction: "outbound" as const,
      from: "+12624061115",
      participants: [
        {
          userId: "u1",
          role: "caller" as const,
          at: "",
          name: "Nazarii",
          roleId: "role-dispatcher",
        },
      ],
    };
    expect(callParty(call, "from").roleId).toBe("role-dispatcher");
  });

  it("resolves a user on both sides of an internal call", () => {
    const call = {
      ...base,
      direction: "outbound" as const,
      from: "+12624061115",
      to: "+12624061116",
      participants: [
        { userId: "u1", role: "caller" as const, at: "", name: "Nazarii" },
        { userId: "u2", role: "answered" as const, at: "", name: "Tamir" },
      ],
    };
    expect(callParty(call, "from").label).toBe("Nazarii");
    expect(callParty(call, "to").label).toBe("Tamir");
  });

  it("falls back to the stored agent, then to a shortened id", () => {
    const unanswered = {
      ...base,
      direction: "inbound" as const,
      to: "+12624061115",
      agentId: "d47814b8-e051-706e",
      agentName: "Nazarii",
    };
    expect(callParty(unanswered, "to")).toEqual({
      kind: "user",
      userId: "d47814b8-e051-706e",
      roleId: undefined,
      label: "Nazarii",
      number: "+12624061115",
    });
    expect(
      callParty({ ...unanswered, agentName: undefined }, "to").label,
    ).toBe("d47814b8…");
  });

  it("returns just the endpoint when neither a user nor a client is known", () => {
    expect(
      callParty({ ...base, direction: "inbound", from: "+380958601427" }, "from"),
    ).toEqual({ kind: "unknown", number: "+380958601427" });
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

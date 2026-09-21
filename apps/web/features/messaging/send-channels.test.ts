import { describe, it, expect } from "vitest";
import type { ConversationSendOptions } from "@bitcrm/types";
import type { InboxConversation } from "./api";
import {
  deadEndText,
  describeDestination,
  fallbackSendOptions,
  optionFor,
  SEND_BUTTON_LABEL,
  unavailableText,
} from "./send-channels";

const conversation = (overrides: Partial<InboxConversation> = {}): InboxConversation => ({
  id: "c1",
  kind: "client",
  partyKind: "contact",
  partyId: "ct1",
  addresses: { phones: ["+14045551234"], emails: ["jane@example.com"] },
  state: "open",
  unread: false,
  unreadCount: 0,
  flagged: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
  ...overrides,
});

describe("send button labels", () => {
  it("names each way out the way the owner asked for it", () => {
    expect(SEND_BUTTON_LABEL).toEqual({ in_app: "Send In App", sms: "Send Text", email: "Send Email" });
  });
});

describe("fallbackSendOptions", () => {
  it("offers a client thread its text and its email, and refuses in-app with the reason", () => {
    const options = fallbackSendOptions(conversation())!;
    expect(options.channels.map((c) => c.channel)).toEqual(["sms", "email", "in_app"]);
    expect(options.defaultChannel).toBe("sms");
    expect(optionFor(options, "in_app")).toEqual({
      channel: "in_app",
      available: false,
      reason: "not_a_team_thread",
    });
  });

  it("leads a team and a group thread with in-app", () => {
    expect(fallbackSendOptions(conversation({ kind: "team", partyKind: "user", partyId: "u2" }))!.defaultChannel).toBe(
      "in_app",
    );
    const group = fallbackSendOptions(
      conversation({ kind: "group", partyKind: "group", partyId: "g1", name: "Dispatch" }),
    )!;
    expect(optionFor(group, "in_app")).toEqual({ channel: "in_app", available: true, toName: "Dispatch" });
  });

  it("closes only what the thread itself proves is missing", () => {
    const options = fallbackSendOptions(conversation({ addresses: { phones: [], emails: [] } }))!;
    expect(optionFor(options, "sms")!.reason).toBe("no_phone");
    expect(optionFor(options, "email")!.reason).toBe("no_email");
    expect(options.defaultChannel).toBeUndefined();
  });

  it("stays out of the way where only the server can know: a teammate's number, a hidden one", () => {
    // The employee's personal phone lives in the directory, not on the thread.
    const employee = fallbackSendOptions(
      conversation({ kind: "team", partyKind: "user", partyId: "u2", addresses: { phones: [], emails: [] } }),
    )!;
    expect(optionFor(employee, "sms")).toEqual({ channel: "sms", available: true });

    const masked = fallbackSendOptions(
      conversation({ addresses: { phones: [], emails: [] }, phonesMasked: true }),
    )!;
    expect(optionFor(masked, "sms")).toEqual({ channel: "sms", available: true, toMasked: true });
  });

  it("has nothing to say without a thread — the first message to a party is a text", () => {
    expect(fallbackSendOptions(undefined)).toBeUndefined();
  });
});

describe("describeDestination", () => {
  it("formats the number a text arrives at and the one it leaves from", () => {
    expect(
      describeDestination({ channel: "sms", available: true, to: "+14045551234", from: "+12025550100" }),
    ).toEqual({ to: "(404) 555-1234", from: "(202) 555-0100" });
  });

  it("prefers the number the agent picked over the one the chain would have chosen", () => {
    const picked = describeDestination(
      { channel: "sms", available: true, to: "+14045551234", from: "+12025550100" },
      "+12025550199",
    );
    expect(picked!.from).toBe("(202) 555-0199");
  });

  it("says a number is hidden rather than showing nothing at all", () => {
    expect(describeDestination({ channel: "sms", available: true, toMasked: true })).toEqual({
      to: "a number you can't see",
    });
  });

  it("gives an email its address and an in-app line the person it reaches", () => {
    expect(describeDestination({ channel: "email", available: true, to: "jane@example.com" })).toEqual({
      to: "jane@example.com",
      from: undefined,
    });
    expect(describeDestination({ channel: "in_app", available: true, toName: "Ann Tech" })).toEqual({ to: "Ann Tech" });
    expect(describeDestination({ channel: "in_app", available: true })).toEqual({ to: "everyone in this thread" });
  });

  it("invents nothing for a channel that resolved no recipient", () => {
    expect(describeDestination({ channel: "sms", available: false, reason: "no_phone" })).toBeUndefined();
    expect(describeDestination(undefined)).toBeUndefined();
  });
});

describe("deadEndText", () => {
  const closed = (channels: ConversationSendOptions["channels"]): ConversationSendOptions => ({
    conversationId: "c1",
    channels,
  });

  it("speaks only when nothing at all can go out, and then names every cause", () => {
    const text = deadEndText(
      closed([
        { channel: "sms", available: false, reason: "no_phone" },
        { channel: "email", available: false, reason: "email_not_configured" },
        { channel: "in_app", available: false, reason: "not_a_team_thread" },
      ]),
    )!;
    expect(text).toContain("Nothing can be sent from this thread.");
    expect(text).toContain(unavailableText("no_phone"));
    expect(text).toContain(unavailableText("email_not_configured"));
    // A client thread is not the kind that carries in-app lines; the menu says
    // so, and repeating it here would read as a fault to fix.
    expect(text).not.toContain(unavailableText("not_a_team_thread"));
  });

  it("stays quiet while one channel still works", () => {
    expect(
      deadEndText(
        closed([
          { channel: "sms", available: false, reason: "opted_out_sms" },
          { channel: "email", available: true, to: "jane@example.com" },
          { channel: "in_app", available: false, reason: "not_a_team_thread" },
        ]),
      ),
    ).toBeUndefined();
    expect(deadEndText(undefined)).toBeUndefined();
  });
});

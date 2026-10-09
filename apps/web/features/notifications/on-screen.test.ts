import { describe, expect, it } from "vitest";
import {
  ON_SCREEN_STORAGE_KEY,
  decideOnScreenNotification,
  readOnScreenSetting,
  writeOnScreenSetting,
  type OnScreenContext,
  type OnScreenInput,
} from "./on-screen";

const ctx: OnScreenContext = {
  enabled: true,
  permission: "granted",
  meId: "me",
  focused: true,
  openConversationId: undefined,
};

const inbound = (over: Partial<OnScreenInput & { kind: "message" }> = {}): OnScreenInput => ({
  kind: "message",
  message: { id: "m1", conversationId: "c1", direction: "inbound", body: "Hello there", ...(over.message ?? {}) },
  conversation: { id: "c1", kind: "client", partyKind: "contact", partyId: "p1", ...(over.conversation ?? {}) },
  partyName: "partyName" in over ? over.partyName : "Jane Doe",
  recipients: over.recipients,
  mentions: over.mentions,
});

describe("decideOnScreenNotification", () => {
  it("fires for an inbound client message with Workiz's words, and a click opens that thread", () => {
    expect(decideOnScreenNotification(inbound(), ctx)).toEqual({
      title: "New message from Jane Doe",
      body: "Hello there",
      tag: "message:m1",
      open: { kind: "thread", conversationId: "c1" },
    });
  });

  it("is quiet while the switch is off, or the browser has not allowed it", () => {
    expect(decideOnScreenNotification(inbound(), { ...ctx, enabled: false })).toBeNull();
    expect(decideOnScreenNotification(inbound(), { ...ctx, permission: "denied" })).toBeNull();
    expect(decideOnScreenNotification(inbound(), { ...ctx, permission: "default" })).toBeNull();
    expect(decideOnScreenNotification(inbound(), { ...ctx, permission: "unsupported" })).toBeNull();
  });

  it("never announces my own messages, nor what the office sent out", () => {
    expect(decideOnScreenNotification(inbound({ message: { direction: "outbound", sentByUserId: "me" } }), ctx)).toBeNull();
    expect(decideOnScreenNotification(inbound({ message: { direction: "outbound" } }), ctx)).toBeNull();
    expect(decideOnScreenNotification(inbound({ message: { direction: "inbound", sentByUserId: "me" } }), ctx)).toBeNull();
  });

  it("stays quiet for the thread already open in the focused tab, but not for one in the background", () => {
    expect(decideOnScreenNotification(inbound(), { ...ctx, openConversationId: "c1", focused: true })).toBeNull();
    expect(decideOnScreenNotification(inbound(), { ...ctx, openConversationId: "c1", focused: false })).not.toBeNull();
    expect(decideOnScreenNotification(inbound(), { ...ctx, openConversationId: "c2", focused: true })).not.toBeNull();
  });

  it("announces a teammate's in-app line to the people it is for, and an @mention by name", () => {
    const team = inbound({
      message: { direction: "outbound", sentByUserId: "u2", sentByName: "Dana Ruiz", body: "Keys are in the van" },
      conversation: { kind: "group", partyKind: "group", name: "Dispatch" },
      recipients: ["me", "u3"],
      partyName: "Dispatch",
    });
    expect(decideOnScreenNotification(team, ctx)).toEqual({
      title: "New message from Dana Ruiz",
      body: "Keys are in the van",
      tag: "message:m1",
      open: { kind: "thread", conversationId: "c1" },
    });
    // Not on the roster: not for me.
    expect(decideOnScreenNotification({ ...team, recipients: ["u3"] }, ctx)).toBeNull();
    expect(decideOnScreenNotification({ ...team, mentions: ["me"] }, ctx)).toEqual({
      title: "Dana Ruiz mentioned you",
      body: "Keys are in the van",
      tag: "message:m1",
      open: { kind: "thread", conversationId: "c1" },
    });
  });

  it("names a sender it cannot resolve by the number, and a body it lacks by what came", () => {
    const bare = inbound({ partyName: undefined, message: { from: "+15550001111", body: undefined, attachments: [{ id: "a" }] } });
    expect(decideOnScreenNotification(bare, ctx)).toEqual({
      title: "New message from +15550001111",
      body: "Attachment",
      tag: "message:m1",
      open: { kind: "thread", conversationId: "c1" },
    });
    expect(decideOnScreenNotification(inbound({ partyName: undefined, message: { from: undefined } }), ctx)?.title).toBe(
      "New message",
    );
  });

  it("cuts a long body to one notification line", () => {
    const long = "x".repeat(300);
    expect(decideOnScreenNotification(inbound({ message: { body: long } }), ctx)?.body).toHaveLength(161);
  });

  it("announces an incoming call, named when the caller is known", () => {
    expect(decideOnScreenNotification({ kind: "call", number: "+15550001111", contactName: "Jane Doe" }, ctx)).toEqual({
      title: "Incoming call",
      body: "Jane Doe · +15550001111",
      tag: "call:+15550001111",
      open: { kind: "call" },
    });
    expect(decideOnScreenNotification({ kind: "call", number: "+15550001111" }, ctx)?.body).toBe("+15550001111");
    expect(decideOnScreenNotification({ kind: "call", number: "+15550001111" }, { ...ctx, enabled: false })).toBeNull();
  });
});

describe("the per-browser setting", () => {
  it("reads off, then what was written, and survives a storage that throws", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(readOnScreenSetting(storage)).toBe(false);
    writeOnScreenSetting(true, storage);
    expect(store.get(ON_SCREEN_STORAGE_KEY)).toBe("1");
    expect(readOnScreenSetting(storage)).toBe(true);
    writeOnScreenSetting(false, storage);
    expect(readOnScreenSetting(storage)).toBe(false);

    const broken = {
      getItem: () => {
        throw new Error("private window");
      },
      setItem: () => {
        throw new Error("private window");
      },
    };
    expect(readOnScreenSetting(broken)).toBe(false);
    expect(() => writeOnScreenSetting(true, broken)).not.toThrow();
  });
});

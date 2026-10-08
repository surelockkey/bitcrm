import { describe, expect, it } from "vitest";
import type { SendMessageBody } from "./api";
import { firstTextBody } from "./first-text";

const body: SendMessageBody = { clientMessageId: "k1", channel: "sms", body: "Hi" };

describe("firstTextBody — who the first text to a party goes to", () => {
  it("a contact with no number named: the contact, the server picks their number", () => {
    expect(firstTextBody(body, { partyKind: "contact", partyId: "c1", dealId: "d1" })).toEqual({
      ...body,
      dealId: "d1",
      contactId: "c1",
    });
  });

  it("a contact texted on one of their own numbers: the contact, on that number", () => {
    expect(
      firstTextBody(body, { partyKind: "contact", partyId: "c1", address: "+15715310137", addressOnParty: true }),
    ).toEqual({ ...body, contactId: "c1", toAddress: "+15715310137" });
  });

  // MS9277: the job carries a number the client record does not.
  it("a contact texted on the job's own number: that number", () => {
    expect(firstTextBody(body, { partyKind: "contact", partyId: "c1", dealId: "d1", address: "+15715310137" })).toEqual({
      ...body,
      dealId: "d1",
      phone: "+15715310137",
    });
  });

  it("a company: its number", () => {
    expect(firstTextBody(body, { partyKind: "company", partyId: "co1", address: "+15715310137" })).toEqual({
      ...body,
      phone: "+15715310137",
    });
  });
});

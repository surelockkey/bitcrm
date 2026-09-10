import { describe, it, expect } from "vitest";
import { ClientType, ContactSource, ContactType } from "@bitcrm/types";
import { companyFormSchema, contactFormSchema } from "./schemas";

/**
 * The forms validate phones on save as well as live in the input — a
 * half-typed number must not slip through a submit.
 */
const contact = (phones: string[]) => ({
  firstName: "Jane",
  lastName: "Smith",
  phones,
  phoneExts: phones.map(() => ""),
  emails: [],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
});

const company = (phones: string[]) => ({
  title: "Acme Storage",
  phones,
  phoneExts: phones.map(() => ""),
  emails: [],
  clientType: ClientType.COMMERCIAL,
});

describe("client schemas — phone rows must be complete numbers", () => {
  it("accepts a full E.164 number", () => {
    expect(contactFormSchema.safeParse(contact(["+14045551234"])).success).toBe(true);
    expect(companyFormSchema.safeParse(company(["+14045551234"])).success).toBe(true);
  });

  it("rejects a half-typed number on save", () => {
    const result = contactFormSchema.safeParse(contact(["+1404555"]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/full phone number/i);
    }
    expect(companyFormSchema.safeParse(company(["+1404555"])).success).toBe(false);
  });

  it("still rejects an empty row with the row message", () => {
    const result = contactFormSchema.safeParse(contact([""]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/enter a phone/i);
    }
  });
});

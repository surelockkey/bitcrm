import { describe, it, expect } from "vitest";
import { ClientType, ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Contact, Company } from "@bitcrm/types";
import {
  formatPhone,
  contactName,
  primaryPhone,
  primaryEmail,
  initials,
  clientTypeLabel,
  contactTypeLabel,
  sourceLabel,
  searchContacts,
  searchCompanies,
} from "./lib";

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    firstName: "Jane",
    lastName: "Smith",
    phones: ["+14045551234"],
    emails: ["jane@acme.com"],
    companyId: "co1",
    type: ContactType.COMPANY_REPRESENTATIVE,
    title: "Facilities Manager",
    source: ContactSource.PHONE_CALL,
    status: CrmStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function company(over: Partial<Company> = {}): Company {
  return {
    id: "co1",
    title: "Acme Storage",
    phones: ["+14045552000"],
    emails: ["hi@acme.com"],
    address: "Phoenix, AZ",
    website: "acme.com",
    clientType: ClientType.COMMERCIAL,
    status: CrmStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("formatPhone", () => {
  it("formats an E.164 US number friendly", () => {
    expect(formatPhone("+14045551234")).toBe("(404) 555-1234");
  });
  it("formats a bare 10-digit number", () => {
    expect(formatPhone("4045551234")).toBe("(404) 555-1234");
  });
  it("strips a leading 1 on 11 digits", () => {
    expect(formatPhone("14045551234")).toBe("(404) 555-1234");
  });
  it("passes through anything it can't normalize", () => {
    expect(formatPhone("+44 20 7946 0000")).toBe("+44 20 7946 0000");
    expect(formatPhone("")).toBe("");
  });
});

describe("contactName / primaries / initials", () => {
  it("joins first and last", () => {
    expect(contactName(contact())).toBe("Jane Smith");
  });
  it("takes the first phone/email as primary", () => {
    expect(primaryPhone(contact({ phones: ["+1a", "+1b"] }))).toBe("+1a");
    expect(primaryEmail(contact({ emails: [] }))).toBeUndefined();
  });
  it("builds initials", () => {
    expect(initials("Jane", "Smith")).toBe("JS");
  });
});

describe("labels", () => {
  it("maps enums to friendly labels", () => {
    expect(clientTypeLabel(ClientType.GOVERNMENT)).toBe("Government");
    expect(contactTypeLabel(ContactType.COMPANY_REPRESENTATIVE)).toBe("Company rep");
    expect(contactTypeLabel(ContactType.RESIDENTIAL)).toBe("Residential");
    expect(sourceLabel(ContactSource.WEB_FORM)).toBe("Web form");
  });
});

describe("searchContacts", () => {
  const list = [
    contact({ id: "a", firstName: "Jane", lastName: "Smith", emails: ["jane@acme.com"], phones: ["+14045551234"] }),
    contact({ id: "b", firstName: "Marcus", lastName: "Reyes", emails: ["marcus@gmail.com"], phones: ["+16025550148"], title: undefined }),
  ];
  it("returns all when query is blank", () => {
    expect(searchContacts(list, "  ")).toHaveLength(2);
  });
  it("matches by name (case-insensitive)", () => {
    expect(searchContacts(list, "reyes").map((c) => c.id)).toEqual(["b"]);
  });
  it("matches by email substring", () => {
    expect(searchContacts(list, "acme.com").map((c) => c.id)).toEqual(["a"]);
  });
  it("matches by phone digits, ignoring formatting", () => {
    expect(searchContacts(list, "(602) 555").map((c) => c.id)).toEqual(["b"]);
  });
  it("does not phone-match on fewer than 3 digits", () => {
    // "60" is inside Marcus's number, but a 2-digit query must not phone-match.
    expect(searchContacts(list, "60")).toHaveLength(0);
  });
});

describe("searchCompanies", () => {
  const list = [
    company({ id: "x", title: "Acme Storage", phones: ["+14045552000"] }),
    company({ id: "y", title: "Sunbelt Realty", phones: ["+14805557700"], address: "Mesa, AZ" }),
  ];
  it("matches by title", () => {
    expect(searchCompanies(list, "sunbelt").map((c) => c.id)).toEqual(["y"]);
  });
  it("matches by address", () => {
    expect(searchCompanies(list, "mesa").map((c) => c.id)).toEqual(["y"]);
  });
  it("matches by phone digits", () => {
    expect(searchCompanies(list, "404 555").map((c) => c.id)).toEqual(["x"]);
  });
});

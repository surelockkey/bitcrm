import { describe, expect, it } from "vitest";
import { ClientType, ContactSource, ContactType, CrmStatus, type Company, type Contact } from "@bitcrm/types";
import {
  clientFormFromContact,
  emptyClientForm,
  jobClientType,
  matchCompany,
  newContactBody,
  pickedClientChanges,
  splitClientName,
} from "./new-job-client";

const contact: Contact = {
  id: "c1",
  firstName: "Dustin",
  lastName: "Roselle",
  phones: ["+14693968179", "+14695550000"],
  phoneExtensions: { "+14693968179": "12" },
  emails: ["dustin@example.com"],
  addresses: [{ street: "Princeton", city: "Princeton", state: "TX", zip: "75407" }],
  companyId: "co-1",
  type: ContactType.COMPANY_REPRESENTATIVE,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u",
  createdAt: "",
  updatedAt: "",
};

const company = (id: string, title: string, clientType = ClientType.COMMERCIAL) =>
  ({ id, title, clientType, phones: [], emails: [] }) as unknown as Company;

describe("splitClientName — Workiz's one 'Client name' box", () => {
  it("first word is the first name, the rest the last name", () => {
    expect(splitClientName("Dustin Roselle")).toEqual({ firstName: "Dustin", lastName: "Roselle" });
    expect(splitClientName("  Mary Ann  Smith ")).toEqual({ firstName: "Mary", lastName: "Ann  Smith" });
  });

  it("one word leaves the last name empty", () => {
    expect(splitClientName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitClientName("   ")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("matchCompany — 'Company name' is a CRM company", () => {
  const list = [company("co-1", "Acme Locks"), company("co-2", "Globex")];
  it("finds one by its title, ignoring case and edge spaces", () => {
    expect(matchCompany(list, "  acme LOCKS ")?.id).toBe("co-1");
  });
  it("finds none for a new name or a blank", () => {
    expect(matchCompany(list, "Initech")).toBeUndefined();
    expect(matchCompany(list, "  ")).toBeUndefined();
  });
});

describe("jobClientType — derived as Workiz implies it", () => {
  it("a company's own type wins", () => {
    expect(jobClientType(company("g", "City", ClientType.GOVERNMENT), "City")).toBe(ClientType.GOVERNMENT);
  });
  it("a company name without a known company is commercial; none is residential", () => {
    expect(jobClientType(undefined, "New Co")).toBe(ClientType.COMMERCIAL);
    expect(jobClientType(undefined, "  ")).toBe(ClientType.RESIDENTIAL);
  });
});

describe("the client form", () => {
  it("starts empty with one phone row (the caller's number when known)", () => {
    expect(emptyClientForm()).toEqual({ name: "", company: "", phones: [{ phone: "", ext: "" }], email: "" });
    expect(emptyClientForm("+14045550123").phones).toEqual([{ phone: "+14045550123", ext: "" }]);
  });

  it("fills from a picked client: name, company, phones with their extensions, email", () => {
    expect(clientFormFromContact(contact, "Acme Locks")).toEqual({
      name: "Dustin Roselle",
      company: "Acme Locks",
      phones: [
        { phone: "+14693968179", ext: "12" },
        { phone: "+14695550000", ext: "" },
      ],
      email: "dustin@example.com",
    });
  });

  it("a client with no phone on file still gets one row", () => {
    expect(clientFormFromContact({ ...contact, phones: [] }, undefined).phones).toEqual([{ phone: "", ext: "" }]);
  });
});

describe("newContactBody — the backend contract for a new client", () => {
  it("splits the name, keys extensions by number, and files them under the company", () => {
    const body = newContactBody(
      {
        name: "Nova Client",
        company: "Acme",
        phones: [
          { phone: "+14045550123", ext: "7" },
          { phone: "+14045550124", ext: "" },
        ],
        email: " nova@example.com ",
      },
      { companyId: "co-1", address: { street: "9 Elm", city: "Austin", state: "TX", zip: "73301", country: "US" } },
    );
    expect(body).toEqual({
      firstName: "Nova",
      lastName: "Client",
      phones: ["+14045550123", "+14045550124"],
      phoneExtensions: { "+14045550123": "7" },
      emails: ["nova@example.com"],
      addresses: [{ street: "9 Elm", city: "Austin", state: "TX", zip: "73301", country: "US" }],
      companyId: "co-1",
      type: ContactType.COMPANY_REPRESENTATIVE,
      source: ContactSource.PHONE_CALL,
    });
  });

  it("a person without a company is residential, with no empty rows sent", () => {
    const body = newContactBody(emptyClientForm(), { address: undefined });
    expect(body).toMatchObject({
      firstName: "",
      lastName: "",
      phones: [],
      emails: [],
      addresses: [],
      type: ContactType.RESIDENTIAL,
    });
    expect(body.phoneExtensions).toBeUndefined();
    expect(body.companyId).toBeUndefined();
  });
});

describe("pickedClientChanges — what editing a picked client means", () => {
  const form = clientFormFromContact(contact, "Acme Locks");

  it("nothing moved: no question, nothing to write", () => {
    expect(pickedClientChanges(contact, form, "co-1")).toEqual({
      edits: { firstName: "Dustin", lastName: "Roselle", phone: "+14693968179" },
      asks: false,
      extras: null,
    });
  });

  it("a new name or main number is the question the save dialog asks", () => {
    const renamed = pickedClientChanges(contact, { ...form, name: "Dustin R. Roselle" }, "co-1");
    expect(renamed.asks).toBe(true);
    expect(renamed.edits).toEqual({ firstName: "Dustin", lastName: "R. Roselle", phone: "+14693968179" });

    const moved = pickedClientChanges(
      contact,
      { ...form, phones: [{ phone: "+14045550000", ext: "" }, form.phones[1]] },
      "co-1",
    );
    expect(moved.asks).toBe(true);
    expect(moved.edits.phone).toBe("+14045550000");
  });

  it("a name the record splits differently is not an edit", () => {
    const odd = { ...contact, firstName: "Mary Ann", lastName: "Smith" };
    expect(pickedClientChanges(odd, clientFormFromContact(odd, "Acme Locks"), "co-1").asks).toBe(false);
  });

  it("email, extension, a second phone or the company are written straight to the client", () => {
    const changed = pickedClientChanges(
      contact,
      {
        ...form,
        email: "new@example.com",
        phones: [{ phone: "+14693968179", ext: "99" }, { phone: "+14695551111", ext: "" }],
      },
      "co-2",
    );
    expect(changed.asks).toBe(false);
    expect(changed.extras).toEqual({
      phones: ["+14693968179", "+14695551111"],
      phoneExtensions: { "+14693968179": "99" },
      emails: ["new@example.com"],
      companyId: "co-2",
      type: ContactType.COMPANY_REPRESENTATIVE,
    });
  });

  it("keeps numbers beyond the ones shown, and the other emails", () => {
    const many = { ...contact, phones: [...contact.phones, "+14695552222"], emails: ["a@x.com", "b@x.com"] };
    const changed = pickedClientChanges(many, { ...clientFormFromContact(many, "Acme Locks"), email: "c@x.com" }, "co-1");
    expect(changed.extras).toMatchObject({
      phones: ["+14693968179", "+14695550000", "+14695552222"],
      emails: ["c@x.com", "b@x.com"],
    });
  });

  it("clearing the company name takes the client off the company", () => {
    const changed = pickedClientChanges(contact, { ...form, company: "" }, undefined);
    expect(changed.extras).toMatchObject({ companyId: undefined, type: ContactType.RESIDENTIAL });
  });
});

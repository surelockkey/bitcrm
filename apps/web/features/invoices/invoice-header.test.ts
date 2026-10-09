import { describe, expect, it } from "vitest";
import type { Address, Contact } from "@bitcrm/types";
import { addressLines, billToLines, formatSlashDate, serviceAddressLines } from "./invoice-header";

const home: Address = { street: "39 Glenbrook Rd", city: "Stamford", state: "CT", zip: "06902" };

/** pg_invoice_wz_01_partial: the invoice header's words, as Workiz writes them. */
describe("formatSlashDate — Workiz's date box ('10/8/2026')", () => {
  it("writes a day as month/day/year without leading zeros", () => {
    expect(formatSlashDate("2026-10-08")).toBe("10/8/2026");
    expect(formatSlashDate("2026-01-30")).toBe("1/30/2026");
  });

  it("writes nothing for no day or a broken one", () => {
    expect(formatSlashDate(undefined)).toBe("");
    expect(formatSlashDate("")).toBe("");
    expect(formatSlashDate("2026-02-31")).toBe("");
  });
});

describe("addressLines — the street over the city", () => {
  it("splits an address into Workiz's two lines", () => {
    expect(addressLines(home)).toEqual(["39 Glenbrook Rd", "Stamford, CT 06902"]);
    expect(addressLines({ ...home, unit: "Apt 2" })).toEqual(["39 Glenbrook Rd, Apt 2", "Stamford, CT 06902"]);
  });

  it("drops an empty line", () => {
    expect(addressLines({ street: "", city: "Stamford", state: "CT", zip: "" })).toEqual(["Stamford, CT"]);
  });
});

describe("billToLines — 'Bill to:'", () => {
  const contact = {
    id: "c1",
    firstName: "Loyda",
    lastName: "Nicola",
    phones: ["+12039123073"],
    emails: ["lnikolla4@gmail.com"],
    billingAddress: home,
    addresses: [{ street: "1 Other St", city: "Austin", state: "TX", zip: "78701" }],
  } as unknown as Contact;

  it("is the name, the billing address, the first phone and the first email", () => {
    expect(billToLines(contact)).toEqual([
      "Loyda Nicola",
      "39 Glenbrook Rd",
      "Stamford, CT 06902",
      "(203) 912-3073",
      "lnikolla4@gmail.com",
    ]);
  });

  it("falls back to the first address when there is no billing one", () => {
    expect(billToLines({ ...contact, billingAddress: undefined } as Contact)).toEqual([
      "Loyda Nicola",
      "1 Other St",
      "Austin, TX 78701",
      "(203) 912-3073",
      "lnikolla4@gmail.com",
    ]);
  });

  it("is empty before the client is known", () => {
    expect(billToLines(undefined)).toEqual([]);
  });
});

describe("serviceAddressLines — 'Service address:' of a job's invoice", () => {
  it("says 'Same as billing address' when the job is at the billing address", () => {
    expect(serviceAddressLines({ ...home, street: " 39 glenbrook rd " }, home)).toEqual(["Same as billing address"]);
  });

  it("reads a state written out ('Connecticut', as Workiz imports jobs) as its code ('CT')", () => {
    expect(serviceAddressLines({ ...home, state: "Connecticut" }, home)).toEqual(["Same as billing address"]);
  });

  it("prints the job's address when it is elsewhere, or when there is no billing address", () => {
    const job: Address = { street: "35 Killingworth Turnpike", city: "Clinton", state: "CT", zip: "06413" };
    expect(serviceAddressLines(job, home)).toEqual(["35 Killingworth Turnpike", "Clinton, CT 06413"]);
    expect(serviceAddressLines(job, undefined)).toEqual(["35 Killingworth Turnpike", "Clinton, CT 06413"]);
  });

  it("is empty for a job with no address", () => {
    expect(serviceAddressLines(undefined, home)).toEqual([]);
    expect(serviceAddressLines({ street: "", city: "", state: "", zip: "" }, home)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { ClientType, CrmStatus, type Company } from "@bitcrm/types";
import {
  COMPANY_DEFAULT_PAGE_SIZE,
  COMPANY_DEFAULT_SORT,
  COMPANY_FIELDS,
  COMPANY_PAGE_SIZES,
  DEFAULT_COMPANY_FIELDS,
  companiesView,
  companyCardPicks,
  companyFilterGroups,
  companyKpis,
  filterCompanies,
  sanitizeCompanyFields,
  selectedCompanyCard,
  websiteHref,
} from "./companies-list";

const company = (over: Partial<Company> = {}): Company => ({
  id: "co1",
  title: "Acme Storage",
  phones: ["+14045551234"],
  emails: [],
  clientType: ClientType.COMMERCIAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "",
  ...over,
});

const acme = company();
const city = company({ id: "co2", title: "City of Mesa", clientType: ClientType.GOVERNMENT, createdAt: "2026-10-05T10:00:00.000Z", phones: ["+14805550000"] });
const grata = company({ id: "co3", title: "Grata Smart Living", isPlatinum: true, createdAt: "2026-10-03T10:00:00.000Z", address: "1920 Yonge St, Toronto", emails: ["amali@grata.life"] });
const homes = company({ id: "co4", title: "StreetLights Homes", clientType: ClientType.RESIDENTIAL, createdAt: "2026-09-30T10:00:00.000Z", phones: [] });
const all = [acme, city, grata, homes];

describe("the Visible fields of the companies grid", () => {
  it("opens on Workiz's Clients columns with the company's type after the name", () => {
    expect(DEFAULT_COMPANY_FIELDS).toEqual(["name", "type", "address", "phone", "created"]);
  });

  it("offers ours — Website and Email — under the used ones", () => {
    expect(COMPANY_FIELDS.map((f) => f.id)).toEqual(["name", "type", "address", "phone", "created", "website", "email"]);
  });

  it("keeps a stored choice that is still known, in its order, once each", () => {
    expect(sanitizeCompanyFields(["phone", "name", "phone", "bogus"])).toEqual(["phone", "name"]);
  });

  it("falls back to the defaults for junk or an empty list", () => {
    expect(sanitizeCompanyFields(null)).toEqual([...DEFAULT_COMPANY_FIELDS]);
    expect(sanitizeCompanyFields([])).toEqual([...DEFAULT_COMPANY_FIELDS]);
  });

  it("pages ten at a time by default, with Workiz's sizes", () => {
    expect(COMPANY_PAGE_SIZES).toEqual([5, 10, 20, 25, 50, 100]);
    expect(COMPANY_DEFAULT_PAGE_SIZE).toBe(10);
  });
});

describe("filterCompanies — Filter results", () => {
  it("keeps everything with nothing picked", () => {
    expect(filterCompanies(all, [])).toEqual(all);
  });

  it("matches ANY of the picked types (OR inside a group)", () => {
    const out = filterCompanies(all, [
      { group: "type", value: ClientType.GOVERNMENT },
      { group: "type", value: ClientType.RESIDENTIAL },
    ]);
    expect(out.map((c) => c.id)).toEqual(["co2", "co4"]);
  });

  it("narrows to platinum accounts, or to the rest", () => {
    expect(filterCompanies(all, [{ group: "platinum", value: "yes" }]).map((c) => c.id)).toEqual(["co3"]);
    expect(filterCompanies(all, [{ group: "platinum", value: "no" }]).map((c) => c.id)).toEqual(["co1", "co2", "co4"]);
  });

  it("needs every group to match (AND across groups)", () => {
    const out = filterCompanies(all, [
      { group: "type", value: ClientType.COMMERCIAL },
      { group: "platinum", value: "yes" },
    ]);
    expect(out.map((c) => c.id)).toEqual(["co3"]);
  });
});

describe("companyFilterGroups — the menu under Filter results", () => {
  it("lists TYPE then PLATINUM, as chips 'type: …' and 'platinum: …'", () => {
    const groups = companyFilterGroups();
    expect(groups.map((g) => [g.id, g.title, g.chipPrefix])).toEqual([
      ["type", "Type", "type"],
      ["platinum", "Platinum", "platinum"],
    ]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Residential", "Commercial", "Government"]);
    expect(groups[1].options.map((o) => [o.value, o.label])).toEqual([
      ["yes", "Yes"],
      ["no", "No"],
    ]);
  });
});

describe("companyKpis — the four cards over the list", () => {
  it("counts the companies, the commercial and government ones and the platinum accounts", () => {
    expect(companyKpis(all).map((k) => [k.key, k.value, k.caption])).toEqual([
      ["all", "4", "Companies"],
      ["commercial", "2", "Commercial"],
      ["government", "1", "Government"],
      ["platinum", "1", "Platinum"],
    ]);
  });

  it("groups thousands as Workiz's cards do", () => {
    const many = Array.from({ length: 1234 }, (_, i) => company({ id: `c${i}` }));
    expect(companyKpis(many)[0].value).toBe("1,234");
  });
});

describe("the cards are the filter (Workiz's Estimates / Invoices cards)", () => {
  it("each card stands for its picks; Companies for none", () => {
    expect(companyCardPicks("all")).toEqual([]);
    expect(companyCardPicks("commercial")).toEqual([{ group: "type", value: ClientType.COMMERCIAL }]);
    expect(companyCardPicks("government")).toEqual([{ group: "type", value: ClientType.GOVERNMENT }]);
    expect(companyCardPicks("platinum")).toEqual([{ group: "platinum", value: "yes" }]);
  });

  it("no card is chosen while nothing is filtered — Workiz's cards turn orange only once clicked", () => {
    expect(selectedCompanyCard([])).toBeNull();
  });

  it("the chosen card is the one whose picks are exactly the filter", () => {
    expect(selectedCompanyCard([{ group: "type", value: ClientType.GOVERNMENT }])).toBe("government");
    expect(selectedCompanyCard([{ group: "platinum", value: "yes" }])).toBe("platinum");
  });

  it("no card is chosen for a filter none of them stands for", () => {
    expect(selectedCompanyCard([{ group: "type", value: ClientType.RESIDENTIAL }])).toBeNull();
    expect(
      selectedCompanyCard([
        { group: "type", value: ClientType.COMMERCIAL },
        { group: "platinum", value: "yes" },
      ]),
    ).toBeNull();
  });
});

describe("companiesView — what the grid shows", () => {
  const base = { query: "", picks: [], sort: COMPANY_DEFAULT_SORT, page: 1, size: 10 };

  it("opens newest first, as Workiz's Clients list does", () => {
    expect(COMPANY_DEFAULT_SORT).toEqual({ id: "created", dir: "desc" });
    expect(companiesView(all, base).rows.map((c) => c.id)).toEqual(["co2", "co3", "co1", "co4"]);
  });

  it("sorts by the header the reader clicked", () => {
    const byName = companiesView(all, { ...base, sort: { id: "name", dir: "asc" } });
    expect(byName.rows.map((c) => c.title)).toEqual(["Acme Storage", "City of Mesa", "Grata Smart Living", "StreetLights Homes"]);
  });

  it("puts a company without a phone last whichever way the Phone header sorts", () => {
    const asc = companiesView(all, { ...base, sort: { id: "phone", dir: "asc" } });
    const desc = companiesView(all, { ...base, sort: { id: "phone", dir: "desc" } });
    expect(asc.rows.at(-1)?.id).toBe("co4");
    expect(desc.rows.at(-1)?.id).toBe("co4");
  });

  it("searches name, address, email and phone digits, then filters by the picks", () => {
    expect(companiesView(all, { ...base, query: "grata" }).rows.map((c) => c.id)).toEqual(["co3"]);
    expect(companiesView(all, { ...base, query: "yonge" }).rows.map((c) => c.id)).toEqual(["co3"]);
    expect(companiesView(all, { ...base, query: "480555" }).rows.map((c) => c.id)).toEqual(["co2"]);
    expect(
      companiesView(all, { ...base, query: "a", picks: [{ group: "type", value: ClientType.GOVERNMENT }] }).rows.map((c) => c.id),
    ).toEqual(["co2"]);
  });

  it("cuts the page and says where it is", () => {
    const view = companiesView(all, { ...base, page: 2, size: 3 });
    expect(view).toMatchObject({ total: 4, page: 2, pages: 2, from: 4, to: 4 });
    expect(view.rows.map((c) => c.id)).toEqual(["co4"]);
  });

  it("an empty result reads 0 to 0 of 0 on page 1", () => {
    expect(companiesView(all, { ...base, query: "zzz" })).toMatchObject({ total: 0, page: 1, pages: 1, from: 0, to: 0, rows: [] });
  });
});

describe("websiteHref — a website as typed, as a link", () => {
  it("adds https:// to a bare host and keeps a full address", () => {
    expect(websiteHref("acme.example")).toBe("https://acme.example");
    expect(websiteHref("http://acme.example/a")).toBe("http://acme.example/a");
    expect(websiteHref("HTTPS://acme.example")).toBe("HTTPS://acme.example");
  });
});

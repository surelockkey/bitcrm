import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  ClientType,
  DealPriority,
  DealStatus,
  DISPATCH_MAP_JOB_FIELDS,
  JobSuperStatus,
  type Deal,
} from "@bitcrm/types";
import { dealClientName, filterDeals, jobOwnNumbers } from "@/features/deals/lib";
import { JobList } from "./components/job-list";
import { JobPinCard } from "./components/job-pin-card";
import { TechPinCard } from "./components/tech-pin-card";
import { matchesMapFilters, EMPTY_MAP_FILTERS } from "./map-filters";
import { isInTimeOrder, splitByLocation, techJobProgress, techJobsToday, technicianPositions } from "./lib";

/**
 * `GET /deals/map` sends each job cut to `DISPATCH_MAP_JOB_FIELDS` (a ~4 KB row
 * becomes ~1 KB). The board must draw and find exactly the same from that cut
 * as from the whole job — every card, stamp, line and search hit. A card that
 * starts reading a field the cut leaves out fails here, instead of the feature
 * quietly vanishing from the map (the Sent / Seen stamps did, 2026-10-12, until
 * the screenshot showed it).
 */

const TODAY = new Date().toISOString().slice(0, 10);

/** A job with every field filled — what `GET /deals/:id` answers. */
const WHOLE: Required<Deal> = {
  id: "d1",
  dealNumber: "K4T9ZW",
  contactId: "c1",
  companyId: "co1",
  clientType: ClientType.COMMERCIAL,
  scheduledDate: TODAY,
  scheduledEndDate: TODAY,
  scheduledTimeSlot: "09:30-11:00",
  allDay: false,
  serviceArea: "Dallas North",
  serviceAreaId: "sa1",
  address: { street: "12 Elm St", unit: "4B", city: "Dallas", state: "TX", zip: "75201", lat: 32.78, lng: -96.8 },
  jobTypeId: "jt1",
  jobName: "Mailbox lock",
  superStatus: JobSuperStatus.IN_PROGRESS,
  stage: undefined as never,
  assignedTechIds: ["t1", "t2"],
  assignedDispatcherId: "u1",
  sequences: { t1: 2 },
  priority: DealPriority.URGENT,
  businessProfileId: "bp1",
  businessProfileName: "Sure Lock",
  sourceId: "src1",
  externalCompanyId: "ext1",
  notes: "Gate code 1234",
  internalNotes: "VIP",
  cancellationReason: "",
  tagIds: ["tag1"],
  subStatusId: "sub1",
  taxRateId: "tx1",
  taxRateName: "Dallas",
  taxRatePercent: 8.25,
  taxSource: "area" as Deal["taxSource"] & string,
  discount: { type: "percent", value: 5 } as Deal["discount"] & object,
  itemCount: 3,
  totals: { subtotal: 100, discount: 5, tax: 7.84, total: 102.84, cost: 40 },
  invoiceId: "d1",
  estimatedTotal: 100,
  actualTotal: 102.84,
  paymentStatus: "partial",
  amountPaid: 50,
  workOrderId: "wo1",
  poNumber: "PO-1",
  customFields: { cf1: "Blue door" },
  externalId: "workiz:job:1",
  workizId: 1,
  jobSerial: 7,
  propId: "p1",
  jobTimezone: "America/Chicago",
  converted: true,
  conversionDate: "2026-01-01",
  hasCalls: true,
  seen: true,
  filesCount: 2,
  lastSent: "2026-10-01T10:00:00Z",
  lastProgress: "2026-10-01T10:00:00Z",
  emailAddress: "job@example.test",
  clientCompanyName: "Acme",
  phones: ["+12145550100"],
  phoneExtensions: { "+12145550100": "12" },
  clientName: { firstName: "Jo", lastName: "Override" },
  clientPhone: "+12145550111",
  status: DealStatus.ACTIVE,
  createdBy: "u1",
  closedAt: "",
  statusChangedAt: "2026-10-01T10:00:00Z",
  sentToTechAt: `${TODAY}T15:04:00.000Z`,
  sentToTechVia: ["sms", "email"],
  sentToTechBy: "u1",
  seenByTechAt: `${TODAY}T15:30:00.000Z`,
  techConfirmedAt: `${TODAY}T15:31:00.000Z`,
  techConfirmedBy: "t1",
  arrivedAt: `${TODAY}T16:00:00.000Z`,
  arrivedBy: "t1",
  arrivedLocation: { lat: 32.78, lng: -96.8 },
  clientConfirmedAt: `${TODAY}T14:00:00.000Z`,
  clientConfirmedVia: "link",
  clientConfirmedBy: "c1",
  clientConfirmedFor: `${TODAY}|09:00-11:00`,
  createdAt: "2026-09-30T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

/** The same job as the map's row carries it. */
const ROW = Object.fromEntries(DISPATCH_MAP_JOB_FIELDS.map((f) => [f, WHOLE[f]])) as unknown as Deal;

const noop = vi.fn();
/** What was drawn — minus the ids dnd-kit numbers per mount. */
const html = (ui: ReactElement) =>
  render(ui).container.innerHTML.replace(/Dnd(DescribedBy|LiveRegion)-\d+/g, "Dnd$1");

describe("a map row draws what the whole job draws", () => {
  it("is smaller than the whole job — it is a cut, not a copy", () => {
    expect(Object.keys(ROW).length).toBeLessThan(Object.keys(WHOLE).length);
    expect(ROW).not.toHaveProperty("notes");
  });

  it.each<[string, (d: Deal) => ReactElement]>([
    [
      "the job card in the list (title, address, status, Sent / Seen)",
      (d) => <JobList mapped={[d]} unmapped={[]} title={(x) => `Lockout - Job #${x.dealNumber}`} hoveredId={null} onHover={noop} onSelect={noop} />,
    ],
    [
      "the pin's card (client, phone, day and slot, address, crew, stop number)",
      (d) => (
        <JobPinCard
          deal={d as Parameters<typeof JobPinCard>[0]["deal"]}
          title={`Lockout - Job #${d.dealNumber}`}
          clientName={dealClientName(d, undefined)}
          phone={jobOwnNumbers(d)[0]}
          techNames={d.assignedTechIds.join(", ")}
          sequence={d.sequences?.[d.assignedTechIds[0]]}
          canEdit
          onEdit={noop}
          onView={noop}
          onAssign={noop}
          onClose={noop}
        />
      ),
    ],
    [
      "a tech's card and their day (availability, progress, the jobs in order)",
      (d) => (
        <TechPinCard
          position={{ userId: "t1", lat: 32.7, lng: -96.8, source: "last_job" }}
          name="Ana Tech"
          jobs={techJobsToday([d], "t1", TODAY)}
          title={(x) => `Lockout - Job #${x.dealNumber}`}
          clientName={(x) => dealClientName(x, undefined)}
          canReorder
          onReorder={noop}
          onSelectJob={noop}
          onClose={noop}
        />
      ),
    ],
  ])("%s", (_what, draw) => {
    expect(html(draw(ROW))).toBe(html(draw(WHOLE)));
  });

  // 2026-10-12 owner rule: the web shows Connecticut's clock. The row carries
  // the zone the visit was booked in (jobTimezone, serviceAreaId), so the
  // pin's card can move a Texas 9:30 CDT to 10:30 EDT and say so.
  it("puts the visit on Connecticut's clock from the zone the row carries", () => {
    const pin = render(
      <JobPinCard
        deal={ROW as Parameters<typeof JobPinCard>[0]["deal"]}
        title="Lockout"
        clientName=""
        canEdit={false}
        onEdit={noop}
        onView={noop}
        onAssign={noop}
        onClose={noop}
      />,
    );
    expect(pin.container).toHaveTextContent(/10:30 am - 12:00 pm E[DS]T/);
    pin.unmount();
    // The area's zone counts for a job without one of its own.
    const tech = render(
      <TechPinCard
        position={{ userId: "t1", lat: 32.7, lng: -96.8, source: "last_job" }}
        name="Ana Tech"
        jobs={[{ ...ROW, jobTimezone: undefined }]}
        zoneOf={(d) => (d.serviceAreaId === "sa1" ? "America/Phoenix" : "America/New_York")}
        title={() => "Lockout"}
        clientName={() => "Bo"}
        canReorder={false}
        onReorder={noop}
        onSelectJob={noop}
        onClose={noop}
      />,
    );
    expect(tech.container).toHaveTextContent(/(12:30 pm - 2:00 pm EDT|11:30 am - 1:00 pm EST)/);
  });

  it("is found by the same searches and filters", () => {
    const contacts = new Map([["c1", { firstName: "Bo", lastName: "Client", phones: ["+12145550199"], emails: ["bo@x.test"] }]]);
    for (const search of ["K4T9ZW", "dallas north", "override", "bo client", "bo@x", "2145550199", "nothing"]) {
      const found = (d: Deal) => filterDeals([d], { search, dateFrom: TODAY, dateTo: TODAY }, contacts).length;
      expect([search, found(ROW)]).toEqual([search, found(WHOLE)]);
    }
    const filters = [
      EMPTY_MAP_FILTERS,
      { ...EMPTY_MAP_FILTERS, techIds: ["t2"] },
      { ...EMPTY_MAP_FILTERS, areas: ["Dallas North"] },
      { ...EMPTY_MAP_FILTERS, statuses: [JobSuperStatus.IN_PROGRESS] },
      { ...EMPTY_MAP_FILTERS, jobTypeIds: ["jt1"] },
    ];
    for (const f of filters) expect(matchesMapFilters(ROW, f)).toBe(matchesMapFilters(WHOLE, f));
  });

  it("places the team and orders their day the same", () => {
    const profiles = [{ userId: "t1", status: "active" }, { userId: "t2", status: "active" }] as Parameters<
      typeof technicianPositions
    >[0];
    expect(technicianPositions(profiles, [ROW], TODAY)).toEqual(technicianPositions(profiles, [WHOLE], TODAY));
    expect(splitByLocation([ROW]).mapped).toHaveLength(splitByLocation([WHOLE]).mapped.length);
    expect(techJobProgress([ROW])).toEqual(techJobProgress([WHOLE]));
    expect(isInTimeOrder([ROW])).toBe(isInTimeOrder([WHOLE]));
  });
});

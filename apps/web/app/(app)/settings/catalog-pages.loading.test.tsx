import { describe, it, expect, vi, afterEach } from "vitest";
import type { ComponentType } from "react";
import { cleanup, screen } from "@testing-library/react";
import { ServiceAreaType } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  type FakeServer,
} from "@/test/page-load";
import { JobTypesPage } from "@/features/job-types/components/job-types-page";
import { JobSourcesPage } from "@/features/job-sources/components/job-sources-page";
import { JobTagsPage } from "@/features/job-tags/components/job-tags-page";
import { JobStatusesPage } from "@/features/job-statuses/components/job-statuses-page";
import { CustomFieldsPage } from "@/features/custom-fields/components/custom-fields-page";
import { ServiceAreasPage } from "@/features/service-areas/components/service-areas-page";
import { ExternalCompaniesPage } from "@/features/external-companies/components/external-companies-page";
import { CompaniesSettingsPage } from "@/features/business-profiles/components/companies-settings-page";

/**
 * The settings catalogs appear once, whole.
 *
 * Each of them used to arrive in three steps: "No access" while the signed-in
 * user was still on its way (a catalog refuses whoever it cannot yet say yes
 * to), then the heading with its "New …" button over two grey bars, then the
 * rows. Whichever answered first — the user or the list — the reader saw the
 * page assemble itself.
 *
 * Now the heading stands over one skeleton until both are in, and the button
 * and the rows come in the same frame. The fake server answers the user last
 * here, the order that showed the "No access" flash; a second run answers the
 * list last, the order that showed the button over the bars.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
}));

const me = {
  id: "u-admin",
  firstName: "Ada",
  lastName: "Admin",
  email: "ada@example.com",
  roleId: "role-admin",
  status: "active",
  createdAt: "",
  updatedAt: "",
};

const stamp = { createdBy: "u-admin", createdAt: "", updatedAt: "" };

interface Catalog {
  name: string;
  Page: ComponentType;
  /** The catalog's endpoint, and one row it holds. */
  list: RegExp;
  rows: unknown[];
  /** What is on screen once the rows are. */
  row: string;
  /** The page's add button ("Add New") — drawn only for a user who may create. */
  button: RegExp;
  /** Other lists the page reads before it is whole (and so waits for). */
  also?: { match: RegExp; rows: unknown[] }[];
}

const CATALOGS: Catalog[] = [
  {
    name: "Job types",
    Page: JobTypesPage,
    list: /\/deals\/job-types$/,
    rows: [{ id: "jt-1", name: "Rekey Visit", priority: 1, active: true, ...stamp }],
    row: "Rekey Visit",
    // Workiz's yellow "Add New" (uikit_wz_set_jobtypes).
    button: /^add new$/i,
  },
  {
    name: "Job sources",
    Page: JobSourcesPage,
    list: /\/deals\/job-sources$/,
    rows: [{ id: "js-1", name: "Flyer Drop", priority: 1, active: true, ...stamp }],
    row: "Flyer Drop",
    button: /^add new$/i,
  },
  {
    name: "Job tags",
    Page: JobTagsPage,
    list: /\/deals\/job-tags$/,
    rows: [{ id: "tg-1", name: "Gate Code", color: "blue", priority: 1, active: true, ...stamp }],
    row: "Gate Code",
    button: /^add new$/i,
  },
  {
    name: "Job statuses",
    Page: JobStatusesPage,
    list: /\/deals\/job-statuses$/,
    rows: [{ id: "st-1", name: "Parts Ordered", group: "pending", color: "amber", priority: 1, active: true, ...stamp }],
    row: "Parts Ordered",
    button: /^add new$/i,
  },
  {
    name: "Custom fields",
    Page: CustomFieldsPage,
    list: /\/deals\/custom-fields$/,
    rows: [
      {
        id: "cf-1",
        name: "Door Color",
        type: "text",
        group: "Site",
        options: [],
        jobTypeIds: [],
        required: false,
        requiredToClose: false,
        searchable: false,
        priority: 1,
        active: true,
        ...stamp,
      },
    ],
    row: "Door Color",
    button: /^add new$/i,
    // The Job Type column names the types the fields are scoped to.
    also: [{ match: /\/deals\/job-types$/, rows: [] }],
  },
  {
    name: "Service areas",
    Page: ServiceAreasPage,
    list: /\/deals\/service-areas$/,
    rows: [
      {
        id: "sa-1",
        name: "Lakeside",
        type: ServiceAreaType.ZIPS,
        definition: { type: ServiceAreaType.ZIPS, zips: [{ zip: "30060" }] },
        priority: 1,
        active: true,
        ...stamp,
      },
    ],
    row: "Lakeside",
    button: /^add service area$/i,
  },
  {
    name: "External companies",
    Page: ExternalCompaniesPage,
    list: /\/deals\/external-companies$/,
    rows: [{ id: "ec-1", name: "Roadside Partners", active: true, ...stamp }],
    row: "Roadside Partners",
    button: /new company/i,
  },
  {
    name: "Companies",
    Page: CompaniesSettingsPage,
    list: /\/billing\/business-profiles$/,
    rows: [{ id: "bp-1", name: "Northside Locks", active: true, isDefault: true, ...stamp }],
    row: "Northside Locks",
    button: /add company/i,
  },
];

/** What a frame of the page holds. */
interface Frame {
  noAccess: boolean;
  skeletons: number;
  rows: boolean;
  button: boolean;
}

/**
 * Every distinct frame the page goes through, in order — caught at each
 * commit by a MutationObserver, so a state that lasts one commit is seen.
 */
function recordFrames(probe: () => Frame) {
  const frames: Frame[] = [];
  let last = "";
  const take = () => {
    const f = probe();
    const key = JSON.stringify(f);
    if (key !== last) {
      frames.push(f);
      last = key;
    }
  };
  const observer = new MutationObserver(take);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  return { frames: () => frames, stop: () => observer.disconnect() };
}

let server: FakeServer;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function load(c: Catalog, order: "user-last" | "list-last") {
  server = installFakeServer([
    { match: /\/users\/me$/, reply: () => me, delayMs: order === "user-last" ? 90 : 20 },
    { match: c.list, reply: () => c.rows, delayMs: order === "list-last" ? 90 : 20 },
    ...(c.also ?? []).map((a) => ({ match: a.match, reply: () => a.rows, delayMs: order === "list-last" ? 90 : 20 })),
  ]);
  const rec = recordFrames(() => ({
    noAccess: !!screen.queryByText("No access"),
    skeletons: skeletonCount(),
    rows: !!screen.queryByText(c.row),
    button: screen.queryAllByRole("button", { name: c.button }).length > 0,
  }));
  renderWithClient(<c.Page />);
  await screen.findByText(c.row);
  await settle();
  rec.stop();
  return rec.frames();
}

describe.each(CATALOGS)("$name settings page", (c) => {
  it.each(["user-last", "list-last"] as const)("goes from one skeleton straight to the whole page (%s)", async (order) => {
    const frames = await load(c, order);

    // Never refuses a user it simply has not heard from yet.
    expect(frames.some((f) => f.noAccess)).toBe(false);

    const first = frames.findIndex((f) => f.rows);
    // Until the rows: the skeleton and nothing of the content — no button
    // over grey bars, no empty frame between two skeletons.
    for (const f of frames.slice(0, first)) {
      expect(f).toEqual(expect.objectContaining({ rows: false, button: false }));
      expect(f.skeletons).toBeGreaterThan(0);
    }
    // The frame the rows arrive in has the button, and no skeleton left.
    expect(frames[first]).toEqual({ noAccess: false, skeletons: 0, rows: true, button: true });
    // And it stays that way.
    for (const f of frames.slice(first)) expect(f.rows).toBe(true);

    expect(duplicates(server.requests)).toEqual([]);
    expect(server.unanswered).toEqual([]);
  });
});

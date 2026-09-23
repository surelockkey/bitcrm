import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * A dispatcher opens a job and watches the fields arrive one after another.
 * The cause is not slowness: the catalogs behind the job's selects — job
 * types, sources, external companies, companies, custom fields — are fetched
 * by the selects themselves, and the selects only mount once the job has
 * arrived. So nothing that a field needs is even asked for until the job is
 * in, and the page fills in waves.
 *
 * None of those catalogs depend on the job. Asking for them the moment the
 * page opens turns two waves into one; they are cached for five minutes, so
 * the next job opens with nothing left to fetch.
 */
const calls: string[] = [];
const state: { data: unknown; isError: boolean } = { data: undefined, isError: false };
const spy = (name: string) => () => {
  calls.push(name);
  return state;
};

vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: spy("jobTypes") }));
vi.mock("@/features/job-sources/hooks", () => ({ useJobSources: spy("jobSources") }));
vi.mock("@/features/external-companies/hooks", () => ({ useExternalCompanies: spy("externalCompanies") }));
vi.mock("@/features/business-profiles/hooks", () => ({ useActiveBusinessProfiles: spy("businessProfiles") }));
vi.mock("@/features/custom-fields/hooks", () => ({ useCustomFields: spy("customFields") }));
vi.mock("@/features/job-statuses/hooks", () => ({ useJobStatuses: spy("jobStatuses") }));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: spy("jobTags") }));

const { useJobPageCatalogs } = await import("./job-page-catalogs");

describe("useJobPageCatalogs", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("asks for every catalog the job page will need", () => {
    renderHook(() => useJobPageCatalogs());
    expect(calls).toEqual(
      expect.arrayContaining([
        "jobTypes",
        "jobSources",
        "externalCompanies",
        "businessProfiles",
        "customFields",
        "jobStatuses",
        "jobTags",
      ]),
    );
  });

  it("asks without waiting to be told which job it is", () => {
    // Nothing here depends on a deal: that is the whole point — these can be
    // in flight while the job itself is still on its way.
    expect(() => renderHook(() => useJobPageCatalogs())).not.toThrow();
    expect(calls.length).toBeGreaterThanOrEqual(7);
  });

  it("is not ready while a catalog is still on its way", () => {
    state.data = undefined;
    state.isError = false;
    expect(renderHook(() => useJobPageCatalogs()).result.current.ready).toBe(false);
  });

  it("is ready once every catalog has answered", () => {
    state.data = [];
    state.isError = false;
    expect(renderHook(() => useJobPageCatalogs()).result.current.ready).toBe(true);
  });

  it("a catalog that failed does not hold the page hostage", () => {
    state.data = undefined;
    state.isError = true;
    expect(renderHook(() => useJobPageCatalogs()).result.current.ready).toBe(true);
  });
});

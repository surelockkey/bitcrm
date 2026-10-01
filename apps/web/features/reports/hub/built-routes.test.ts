import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { builtRoutes } from "./built-routes";

/** apps/web — where `next build` and `next dev` run. */
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("builtRoutes", () => {
  it("keeps the routes that have a page and drops the ones that don't", () => {
    expect(builtRoutes(["/reports/jobs", "/estimates", "/reports/no-such-report", "/invoices"], WEB)).toEqual([
      "/reports/jobs",
      "/estimates",
      "/invoices",
    ]);
  });

  it("finds the app from the repository root too", () => {
    expect(builtRoutes(["/reports/job-statistics", "/nowhere"], path.resolve(WEB, "../.."))).toEqual([
      "/reports/job-statistics",
    ]);
  });

  it("a folder without a page is not a page", () => {
    // `app/(app)/reports` has its own page; `features` is not a route at all.
    expect(builtRoutes(["/reports", "/features"], WEB)).toEqual(["/reports"]);
  });

  it("says it doesn't know when there is no app directory", () => {
    expect(builtRoutes(["/reports/jobs"], path.join(WEB, "features"))).toBeNull();
  });
});

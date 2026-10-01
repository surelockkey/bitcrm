import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import Page from "./page";
import { REPORT_TILES } from "@/features/reports/hub/report-tiles";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("/reports", () => {
  it("hands the hub exactly the report routes this checkout has a page for", () => {
    const built: string[] = Page().props.built;
    const routes = REPORT_TILES.flatMap((t) => (t.href ? [t.href] : []));

    // The reports on main open…
    for (const href of ["/reports/jobs", "/reports/job-statistics", "/estimates", "/invoices", "/payments"]) {
      expect(built).toContain(href);
    }
    // …and every route is judged by whether its page file is really there.
    for (const href of routes) {
      const page = path.join(APP, ...href.split("/").filter(Boolean), "page.tsx");
      expect(built.includes(href)).toBe(existsSync(page));
    }
  });
});

import { describe, expect, it } from "vitest";

import * as jobPills from "@/features/deals/components/job-pills";
import { wzPill } from "./pill";

/**
 * The job page drew its own Workiz pills (features/deals/components/
 * job-pills.ts). The kit owns them now; until the job page switches, the
 * kit's must be the very same classes so the switch is pixel-identical.
 */
describe("wzPill", () => {
  it("reproduces the job page's pills class for class", () => {
    expect(wzPill("yellow")).toBe(jobPills.PILL_YELLOW);
    expect(wzPill("outline")).toBe(jobPills.PILL_OUTLINE);
    expect(wzPill("outline", "tall")).toBe(jobPills.PILL_OUTLINE_TALL);
    expect(wzPill("yellow", "small")).toBe(jobPills.PILL_YELLOW_SM);
  });

  it("is always a pill, never a padded rounded-full", () => {
    for (const cls of [wzPill("yellow"), wzPill("outline"), wzPill("outline", "tall"), wzPill("yellow", "small")]) {
      expect(cls).toContain("rounded-pill");
      expect(cls).not.toMatch(/(?<![\w:-])rounded-full/);
    }
  });
});

import { describe, it, expect } from "vitest";
import { RESOURCE_REGISTRY } from "@bitcrm/types";
import { SYSTEM_ROLES } from "./system-roles";

/**
 * This client mirror gates UI on the frontend (nav visibility, action buttons)
 * because there is no self-serve resolved-permissions endpoint. `can()` has no
 * Super Admin bypass, so a resource missing from a role here reads as denied for
 * everyone — hiding its Settings nav item, page, and create button.
 */
describe("SYSTEM_ROLES job_statuses grant", () => {
  it("mirrors job_tags onto job_statuses in every system role", () => {
    // job_statuses is a job catalog seeded identically to job_tags (backend
    // default-roles d1115ee does the same). Client and server must agree.
    for (const [roleId, role] of Object.entries(SYSTEM_ROLES)) {
      expect(role.permissions.job_statuses, `role ${roleId}`).toEqual(
        role.permissions.job_tags,
      );
    }
  });

  it("grants job_statuses.view to at least the roles that see job_tags", () => {
    for (const [roleId, role] of Object.entries(SYSTEM_ROLES)) {
      if (role.permissions.job_tags?.view) {
        expect(role.permissions.job_statuses?.view, `role ${roleId}`).toBe(true);
      }
    }
  });

  it("keeps job_statuses a known registry resource", () => {
    expect(Object.keys(RESOURCE_REGISTRY)).toContain("job_statuses");
  });
});

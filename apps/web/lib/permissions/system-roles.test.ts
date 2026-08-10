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

/**
 * The guard that would have caught custom_fields (and work_orders) being absent:
 * every registered resource must be declared, with boolean actions, in EVERY
 * system role — otherwise `can()` denies it for everyone and the feature's nav
 * item / page silently vanish. Mirrors the backend default-roles consistency spec.
 */
describe("SYSTEM_ROLES <-> RESOURCE_REGISTRY consistency", () => {
  const resources = Object.keys(RESOURCE_REGISTRY) as Array<
    keyof typeof RESOURCE_REGISTRY
  >;

  it.each(Object.entries(SYSTEM_ROLES))(
    "role %s declares a view grant for every registered resource",
    (_roleId, role) => {
      // `view` is the action that gates nav visibility, so a resource absent
      // here (undefined -> denied) silently hides its Settings item for everyone.
      for (const resource of resources) {
        const perms = role.permissions[resource];
        expect(perms, `${role.id} is missing ${resource}`).toBeDefined();
        expect(
          typeof perms!.view,
          `${role.id}.${resource}.view`,
        ).toBe("boolean");
      }
    },
  );
});

describe("SYSTEM_ROLES custom_fields grant", () => {
  it("mirrors job_statuses onto custom_fields in every system role", () => {
    // custom_fields is a settings catalog seeded at the job_statuses level on the
    // backend (default-roles). Client and server must agree.
    for (const [roleId, role] of Object.entries(SYSTEM_ROLES)) {
      expect(role.permissions.custom_fields, `role ${roleId}`).toEqual(
        role.permissions.job_statuses,
      );
    }
  });

  it("grants custom_fields.view to every role that can see the Settings area", () => {
    for (const [roleId, role] of Object.entries(SYSTEM_ROLES)) {
      if (role.permissions.settings?.view) {
        expect(role.permissions.custom_fields?.view, `role ${roleId}`).toBe(true);
      }
    }
  });
});

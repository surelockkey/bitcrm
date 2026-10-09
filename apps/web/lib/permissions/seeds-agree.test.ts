import { describe, expect, it } from "vitest";
import { RESOURCE_REGISTRY } from "@bitcrm/types";
import { DEFAULT_ROLES } from "../../../../backend/services/user/src/roles/constants/default-roles";
import { SYSTEM_ROLES } from "./system-roles";

/**
 * The two role seeds — the server's (user-service `DEFAULT_ROLES`) and this
 * client mirror (`SYSTEM_ROLES`, which the web gates on) — must grant the
 * same thing for every registered permission of every system role. The
 * 2026-10-06 audit compared them with a scratch script; nothing held them
 * together. A permission added to the registry and seeded on one side only
 * fails here.
 */
const registry = RESOURCE_REGISTRY as unknown as Record<string, readonly string[]>;

describe("role seeds: server and web agree", () => {
  it("seed the same roles", () => {
    expect(Object.keys(SYSTEM_ROLES).sort()).toEqual(DEFAULT_ROLES.map((r) => r.id).sort());
  });

  it.each(DEFAULT_ROLES.map((r) => [r.id, r] as const))(
    "%s: every registered action is a boolean on both sides, and the same",
    (id, server) => {
      const web = SYSTEM_ROLES[id];
      const mismatches: string[] = [];
      for (const [resource, actions] of Object.entries(registry)) {
        for (const action of actions) {
          const s = (server.permissions as Record<string, Record<string, boolean>>)[resource]?.[action];
          const w = (web.permissions as Record<string, Record<string, boolean>>)[resource]?.[action];
          if (typeof s !== "boolean" || typeof w !== "boolean" || s !== w) {
            mismatches.push(`${resource}.${action}: server ${String(s)}, web ${String(w)}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
    },
  );
});

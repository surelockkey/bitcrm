import type { Container } from "@bitcrm/types";

/**
 * Containers are named directly now; rows written before that fall back to
 * the technician-derived label they always displayed.
 */
export function containerTitle(
  c: Pick<Container, "name" | "technicianName">,
): string {
  return c.name?.trim() || c.technicianName?.trim() || "Container";
}

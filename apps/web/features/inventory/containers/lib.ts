import type { Container } from "@bitcrm/types";

/** Containers store no name of their own — label from the technician. */
export function containerTitle(c: Pick<Container, "technicianName">): string {
  return c.technicianName?.trim() || "Container";
}

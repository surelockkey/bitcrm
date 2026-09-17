import { toast } from "sonner";
import type { ActionResult } from "../store";

/** Surfaces a rejected editor action (limits, invalid layouts) as a toast. */
export function reportResult(result: ActionResult): boolean {
  if (!result.ok) toast.error(result.error);
  return result.ok;
}

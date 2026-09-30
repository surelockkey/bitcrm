import { TriangleAlert } from "lucide-react";

/**
 * "Nothing picked here widens the rule." A picker emptied of its last value
 * stops narrowing anything: `toSpec` stores neither an emptied condition nor
 * an emptied `trigger.to`, and the engine reads what is left as "this is not
 * narrowed" — a condition that matched one source now matches every source, a
 * trigger that fired on Done now fires on every status change.
 *
 * It is a warning, not a refusal: both are legal rules, and Workiz allowed
 * both. One note, in one place, because the reader meets it beside the
 * trigger and beside a condition and has to recognise it as the same thing —
 * and because the live sentence at the top of the dialog is usually scrolled
 * out of sight by the time anybody is unticking values.
 */
export const AutomationEmptyNote = () => (
  <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
    <TriangleAlert className="size-3.5 shrink-0" />
    Nothing picked, so this line narrows nothing and is not saved with the rule.
  </p>
);

/**
 * Checks whether a deal stage transition is allowed by the given rules.
 *
 * Rules format: "from->to" where either side can be "*" (wildcard).
 * Examples:
 *   "lead->qualified"   — exact match
 *   "*->canceled"       — any stage to canceled
 *   "lead->*"           — lead to any stage
 *   "*->*"              — unrestricted
 *
 * Empty rules array → deny all transitions.
 */
export function canTransitionStage(
  from: string,
  to: string,
  allowedTransitions: string[],
): boolean {
  return allowedTransitions.some((rule) => {
    const [ruleFrom, ruleTo] = rule.split('->');
    const fromMatch = ruleFrom === '*' || ruleFrom === from;
    const toMatch = ruleTo === '*' || ruleTo === to;
    return fromMatch && toMatch;
  });
}

import { DealStage, TERMINAL_STAGES } from '@bitcrm/types';

/**
 * Parses a transition string like "new_lead->assigned" into [from, to].
 * Wildcard "*" means "any stage".
 */
function parseTransition(t: string): [string, string] {
  const [from, to] = t.split('->');
  return [from, to];
}

/**
 * Checks if a stage transition is allowed given the user's dealStageTransitions array.
 *
 * The transitions array comes from the user's resolved permissions (role base + overrides).
 * Format: ["from->to", "*->canceled", "*->*"]
 */
export function canTransition(
  dealStageTransitions: string[],
  fromStage: DealStage,
  toStage: DealStage,
): boolean {
  // Cannot transition from terminal stages
  if (TERMINAL_STAGES.has(fromStage)) {
    return false;
  }

  // Cannot transition to the same stage
  if (fromStage === toStage) {
    return false;
  }

  for (const t of dealStageTransitions) {
    const [from, to] = parseTransition(t);

    const fromMatch = from === '*' || from === fromStage;
    const toMatch = to === '*' || to === toStage;

    if (fromMatch && toMatch) {
      return true;
    }
  }

  return false;
}

/**
 * Returns all stages the user can transition TO from the current stage.
 */
export function getAllowedNextStages(
  dealStageTransitions: string[],
  currentStage: DealStage,
): DealStage[] {
  if (TERMINAL_STAGES.has(currentStage)) {
    return [];
  }

  const allowed: DealStage[] = [];
  const allStages = Object.values(DealStage);

  for (const target of allStages) {
    if (target === currentStage) continue;
    if (canTransition(dealStageTransitions, currentStage, target)) {
      allowed.push(target);
    }
  }

  return allowed;
}

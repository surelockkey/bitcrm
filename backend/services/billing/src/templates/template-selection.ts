import type { DocumentTemplate, DocumentTemplateKind } from '@bitcrm/types';

export interface TemplateSelectionInput {
  kind: DocumentTemplateKind;
  /** The document's explicit template. */
  templateId?: string | null;
  jobTypeId?: string;
  serviceAreaId?: string;
  /** The job's company (business profile). */
  businessProfileId?: string;
}

type Selectable = Pick<DocumentTemplate, 'id' | 'kind' | 'isDefault' | 'autoApply' | 'createdAt'>;

/**
 * How specifically a template's auto-apply rule matches, or 0 when it does
 * not apply. Every dimension the rule names (company, job type, service area)
 * must match; the score is the number of dimensions it names.
 */
export function autoApplyScore(rule: DocumentTemplate['autoApply'], input: TemplateSelectionInput): number {
  if (!rule) return 0;
  const dims: Array<[string[] | undefined, string | undefined]> = [
    [rule.businessProfileIds, input.businessProfileId],
    [rule.jobTypeIds, input.jobTypeId],
    [rule.serviceAreaIds, input.serviceAreaId],
  ];
  let score = 0;
  for (const [ids, value] of dims) {
    if (!ids?.length) continue;
    if (!value || !ids.includes(value)) return 0;
    score++;
  }
  return score;
}

/**
 * Which template renders a document: explicit → the most specific auto-apply
 * match (company + job type + service area; ties → the oldest template) →
 * the kind's default. `null` means the caller should fall back to the seeded
 * default.
 */
export function selectTemplate<T extends Selectable>(templates: T[], input: TemplateSelectionInput): T | null {
  const ofKind = templates.filter((t) => t.kind === input.kind);

  if (input.templateId) {
    const explicit = ofKind.find((t) => t.id === input.templateId);
    if (explicit) return explicit;
  }

  let best: { t: T; score: number } | null = null;
  for (const t of [...ofKind].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const score = autoApplyScore(t.autoApply, input);
    if (score > 0 && (!best || score > best.score)) best = { t, score };
  }
  if (best) return best.t;

  return ofKind.find((t) => t.isDefault) ?? null;
}

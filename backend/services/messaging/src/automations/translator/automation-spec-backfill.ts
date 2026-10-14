import { type UpdateCommandInput } from '@aws-sdk/lib-dynamodb';
import { isOwnAutomationSpec, type AutomationRule } from '@bitcrm/types';
import { METADATA_SK, automationPk } from '../../common/constants/dynamo.constants';
import { isBuiltinRuleId } from '../builtin-rules';
import { TRANSLATOR_VERSION, translateWorkizRule } from './workiz-translator';

/**
 * Whether the stored row is an imported Workiz rule whose spec is missing or
 * was written by an older translator — the rows `GET /automations` has to
 * translate on the way out. A built-in, a hand-written spec, an imported
 * Notification Center row and a row with nothing to translate never are.
 */
export function needsTranslation(rule: AutomationRule): boolean {
  if (isBuiltinRuleId(rule.id)) return false;
  // A hand-written spec and an imported Notification Center row are both
  // already specs; running the translator over either would replace a rule
  // that works with one built from Workiz fields these rows do not have.
  if (isOwnAutomationSpec(rule.specSource)) return false;
  if (rule.specSource === 'workiz-translator' && rule.specVersion === TRANSLATOR_VERSION) return false;
  return !!(rule.events || rule.conditions || rule.spec);
}

/** The row with the current translation laid over it — what the read path serves. */
export function withTranslatedSpec(rule: AutomationRule): AutomationRule {
  if (!needsTranslation(rule)) return rule;
  const { spec, runnable, notRunnableReason, notes } = translateWorkizRule(rule);
  return {
    ...rule,
    ...(spec ? { spec } : {}),
    specSource: 'workiz-translator',
    specVersion: TRANSLATOR_VERSION,
    runnable,
    ...(notRunnableReason ? { notRunnableReason } : {}),
    ...(notes.length ? { specNotes: notes } : {}),
  };
}

/**
 * The `UpdateItem` that saves a row's translation (`backfill:automation-specs`),
 * or `null` when the row needs none — so a second run writes nothing.
 *
 * Upsert-only on the spec fields (`spec`, `specSource`, `specVersion`,
 * `runnable`, `notRunnableReason`, `specNotes`); the Workiz fields, the name,
 * `enabled` and `updatedAt` are not touched — this is not an edit. A reason
 * or notes the new translation no longer gives are removed rather than left
 * describing an older translator.
 *
 * Conditional on the row being exactly as read — same `specSource`,
 * `specVersion` and `updatedAt` (or still without them) — so a rule somebody
 * edited (and so made `specSource: 'user'`) or deleted after the read is left
 * alone; the caller counts that as raced.
 */
export function automationSpecBackfillUpdate(rule: AutomationRule, tableName: string): UpdateCommandInput | null {
  if (!needsTranslation(rule)) return null;
  const translated = translateWorkizRule(rule);

  const names: Record<string, string> = {
    '#specSource': 'specSource',
    '#specVersion': 'specVersion',
    '#runnable': 'runnable',
    '#notRunnableReason': 'notRunnableReason',
    '#specNotes': 'specNotes',
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, unknown> = {
    ':specSource': 'workiz-translator',
    ':specVersion': TRANSLATOR_VERSION,
    ':runnable': translated.runnable,
  };
  const set = ['#specSource = :specSource', '#specVersion = :specVersion', '#runnable = :runnable'];
  const remove: string[] = [];

  if (translated.spec) {
    names['#spec'] = 'spec';
    values[':spec'] = translated.spec;
    set.unshift('#spec = :spec');
  }
  if (translated.notRunnableReason) {
    values[':notRunnableReason'] = translated.notRunnableReason;
    set.push('#notRunnableReason = :notRunnableReason');
  } else {
    remove.push('#notRunnableReason');
  }
  if (translated.notes.length) {
    values[':specNotes'] = translated.notes;
    set.push('#specNotes = :specNotes');
  } else {
    remove.push('#specNotes');
  }

  const unchanged = (attr: 'specSource' | 'specVersion' | 'updatedAt'): string => {
    const read = rule[attr];
    if (read === undefined || read === null) return `attribute_not_exists(#${attr})`;
    const placeholder = `:read${attr[0].toUpperCase()}${attr.slice(1)}`;
    values[placeholder] = read;
    return `#${attr} = ${placeholder}`;
  };

  return {
    TableName: tableName,
    Key: { PK: automationPk(rule.id), SK: METADATA_SK },
    UpdateExpression: `SET ${set.join(', ')}${remove.length ? ` REMOVE ${remove.join(', ')}` : ''}`,
    ConditionExpression: [
      'attribute_exists(PK)',
      unchanged('specSource'),
      unchanged('specVersion'),
      unchanged('updatedAt'),
    ].join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

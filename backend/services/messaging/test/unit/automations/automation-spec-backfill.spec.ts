import { type AutomationRule } from '@bitcrm/types';
import {
  automationSpecBackfillUpdate,
  needsTranslation,
  withTranslatedSpec,
} from '../../../src/automations/translator/automation-spec-backfill';
import { TRANSLATOR_VERSION } from '../../../src/automations/translator/workiz-translator';
import { T0 } from '../mocks';

/**
 * `backfill:automation-specs` saves the translation `GET /automations`
 * would otherwise compute on every read, at the current translator
 * version, onto each outdated imported row — conditionally, so a rule
 * somebody edited in the meantime is never overwritten.
 */
const translatable = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'w3',
  name: 'Canceled job & techs',
  enabled: false,
  source: 'workiz',
  entities: ['job'],
  conditions: {
    all: [{ fact: 'sub_status_id', operator: 'equal', value: '15037', friendly_strings: { value: 'canceled check' } }],
  },
  events: [
    {
      type: 'notification',
      notify_medium: 'sms',
      receiverType: 'tech',
      message_template: '<p>CLIENT CANCELED {{uuid}}</p>',
      time_interval: { value: 0, time_unit: 'minutes' },
    },
  ],
  createdAt: T0,
  updatedAt: T0,
  ...over,
} as AutomationRule);

const TABLE = 'BitCRM_Messaging';

describe('needsTranslation', () => {
  it('is true for an imported row never translated, or translated by an older version', () => {
    expect(needsTranslation(translatable())).toBe(true);
    expect(needsTranslation(translatable({ specSource: 'workiz-translator', specVersion: TRANSLATOR_VERSION - 1 }))).toBe(true);
  });

  it('is false for a current translation, a hand-written spec, a built-in and a row with nothing to translate', () => {
    expect(needsTranslation(translatable({ specSource: 'workiz-translator', specVersion: TRANSLATOR_VERSION }))).toBe(false);
    expect(needsTranslation(translatable({ specSource: 'user', specVersion: 1 }))).toBe(false);
    expect(needsTranslation({ ...translatable(), id: 'on-my-way' })).toBe(false);
    expect(needsTranslation(translatable({ events: undefined, conditions: undefined, spec: undefined }))).toBe(false);
  });
});

describe('withTranslatedSpec', () => {
  it('is what the read path serves: the spec at the current version, the Workiz fields untouched', () => {
    const rule = withTranslatedSpec(translatable());
    expect(rule).toMatchObject({ specSource: 'workiz-translator', specVersion: TRANSLATOR_VERSION, runnable: true });
    expect(rule.spec?.trigger.kind).toBe('deal.status_changed');
    expect(rule.conditions).toEqual(translatable().conditions);
  });

  it('leaves a row that needs nothing as it is', () => {
    const own = translatable({ specSource: 'user', specVersion: 1 });
    expect(withTranslatedSpec(own)).toBe(own);
  });
});

describe('automationSpecBackfillUpdate', () => {
  it('writes only the spec fields, conditioned on the row being exactly as read', () => {
    const row = translatable({ specSource: 'workiz-translator', specVersion: 1, notRunnableReason: 'old reason' });
    const update = automationSpecBackfillUpdate(row, TABLE)!;

    expect(update.TableName).toBe(TABLE);
    expect(update.Key).toEqual({ PK: 'AUTOMATION#w3', SK: 'METADATA' });
    expect(update.UpdateExpression).toMatch(/^SET /);
    expect(update.UpdateExpression).toContain('#spec = :spec');
    expect(update.UpdateExpression).toContain('#specVersion = :specVersion');
    expect(update.UpdateExpression).toMatch(/REMOVE .*#notRunnableReason/); // runnable now: the old reason goes
    expect(update.UpdateExpression).not.toContain('updatedAt =');
    expect(update.ExpressionAttributeValues![':specVersion']).toBe(TRANSLATOR_VERSION);
    expect(update.ExpressionAttributeValues![':runnable']).toBe(true);

    // Optimistic: the row is still the one read — same version, same source, same updatedAt.
    expect(update.ConditionExpression).toContain('attribute_exists(PK)');
    expect(update.ConditionExpression).toContain('#specVersion = :readSpecVersion');
    expect(update.ConditionExpression).toContain('#specSource = :readSpecSource');
    expect(update.ConditionExpression).toContain('#updatedAt = :readUpdatedAt');
    expect(update.ExpressionAttributeValues![':readSpecVersion']).toBe(1);
    expect(update.ExpressionAttributeValues![':readUpdatedAt']).toBe(T0);
  });

  it('spells a missing attribute as attribute_not_exists in the condition', () => {
    const update = automationSpecBackfillUpdate(translatable({ updatedAt: undefined as unknown as string }), TABLE)!;
    expect(update.ConditionExpression).toContain('attribute_not_exists(#specVersion)');
    expect(update.ConditionExpression).toContain('attribute_not_exists(#specSource)');
    expect(update.ConditionExpression).toContain('attribute_not_exists(#updatedAt)');
    expect(update.ExpressionAttributeValues).not.toHaveProperty(':readSpecVersion');
  });

  it('keeps the reason and notes of a rule that still cannot run', () => {
    const update = automationSpecBackfillUpdate(translatable({ id: 'w4', entities: ['invoice'], events: [] }), TABLE)!;
    expect(update.ExpressionAttributeValues![':runnable']).toBe(false);
    expect(typeof update.ExpressionAttributeValues![':notRunnableReason']).toBe('string');
    expect(update.UpdateExpression).toContain('#notRunnableReason = :notRunnableReason');
  });

  it('is null for a row that needs nothing — the second run writes nothing', () => {
    expect(automationSpecBackfillUpdate(translatable({ specSource: 'workiz-translator', specVersion: TRANSLATOR_VERSION }), TABLE)).toBeNull();
    expect(automationSpecBackfillUpdate(translatable({ specSource: 'user' }), TABLE)).toBeNull();
  });
});

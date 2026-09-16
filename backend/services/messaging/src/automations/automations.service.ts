import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type AutomationRule, type BuiltinAutomationRuleId } from '@bitcrm/types';
import { NOTHING_EXECUTABLE_REASON, hasExecutableAction } from './automations.constants';
import { AutomationsRepository } from './automations.repository';
import { BUILTIN_RULES, isBuiltinRuleId } from './builtin-rules';
import { type CreateAutomationDto } from './dto/create-automation.dto';
import { type UpdateAutomationDto } from './dto/update-automation.dto';
import { TRANSLATOR_VERSION, translateWorkizRule } from './translator/workiz-translator';

/**
 * Raised when a rule the engine has no spec for is switched on: an imported
 * Workiz rule whose trigger, conditions or actions have no BitCRM
 * equivalent stays data. The translator's own reason is part of the
 * message, so the settings page can say why.
 */
export class RuleNotRunnableException extends HttpException {
  constructor(ruleId: string, reason?: string) {
    super(
      `RULE_NOT_RUNNABLE: automation rule ${ruleId} cannot run${reason ? `: ${reason}` : ''}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** What `migrate()` did, per rule — the coverage table. */
export interface AutomationMigrationRow {
  id: string;
  name: string;
  runnable: boolean;
  reason?: string;
  trigger?: string;
  actions: string[];
  workizEnabled?: boolean;
  workizTriggered?: number;
  written: boolean;
}

/**
 * Rules as data and as specs (M21): the stored rows, the built-in defaults
 * for any built-in rule nobody has edited yet, and — for every imported
 * Workiz rule without a hand-written spec — the translation, computed at
 * read time. Nothing is written until somebody edits a rule or calls
 * `POST /automations/migrate`, so improving the translator needs no data
 * migration: the next read is simply better.
 */
@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(private readonly repository: AutomationsRepository) {}

  /** Stored rules, with the built-ins filled in from code where unstored; by name. */
  async list(): Promise<AutomationRule[]> {
    const stored = await this.repository.list();
    const seen = new Set(stored.map((r) => r.id));
    const builtins = Object.values(BUILTIN_RULES).filter((r) => !seen.has(r.id));
    return [...stored.map((r) => this.overlay(r)), ...builtins].sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id),
    );
  }

  /** Stored row over the built-in default; 404 for anything else. */
  async get(id: string): Promise<AutomationRule> {
    const rule = await this.find(id);
    if (!rule) throw new NotFoundException(`Automation rule ${id} not found`);
    return rule;
  }

  /** `null` instead of 404 — what the executors ask. */
  async find(id: string): Promise<AutomationRule | null> {
    const stored = await this.repository.get(id);
    if (stored) return this.overlay(stored);
    return isBuiltinRuleId(id) ? BUILTIN_RULES[id] : null;
  }

  /** Whether a built-in rule should fire right now. */
  async isEnabled(id: BuiltinAutomationRuleId): Promise<boolean> {
    const rule = await this.find(id);
    return rule?.enabled === true;
  }

  /**
   * `POST /automations` — a rule written here rather than imported. It is
   * `source: 'bitcrm'` / `specSource: 'user'` from birth, so the translator
   * never touches it, and it is off unless the caller asks otherwise: a new
   * rule is read once before it texts anybody. Asking for it on with a spec
   * the engine cannot act on is the same 422 `PATCH` answers.
   */
  async create(dto: CreateAutomationDto, caller: { id: string }): Promise<AutomationRule> {
    const at = new Date().toISOString();
    const spec = dto.spec as unknown as AutomationRule['spec'];
    const runnable = hasExecutableAction(spec?.actions);
    const id = randomUUID();
    if (dto.enabled === true && !runnable) throw new RuleNotRunnableException(id, NOTHING_EXECUTABLE_REASON);

    const saved = await this.repository.put({
      id,
      name: dto.name.trim(),
      enabled: dto.enabled === true,
      ...(dto.description ? { description: dto.description } : {}),
      ...(dto.category ? { category: dto.category } : {}),
      spec,
      specSource: 'user',
      specVersion: TRANSLATOR_VERSION,
      runnable,
      ...(runnable ? {} : { notRunnableReason: NOTHING_EXECUTABLE_REASON }),
      source: 'bitcrm',
      createdAt: at,
      updatedAt: at,
      createdBy: caller.id,
      updatedBy: caller.id,
    });
    this.logger.log(`Automation rule ${id} "${saved.name}" created by ${caller.id} (enabled=${saved.enabled})`);
    return saved;
  }

  /**
   * `PATCH /automations/:id` — enable / disable / rename / edit the spec.
   * Whole-document write over what is stored (or over the built-in default
   * on first edit). Enabling a rule the engine cannot run is refused with
   * the translator's own reason; a spec a person edited is theirs from then
   * on (`specSource: 'user'`) and is never re-translated.
   */
  async update(id: string, dto: UpdateAutomationDto, caller: { id: string }): Promise<AutomationRule> {
    const current = await this.get(id);
    const next: AutomationRule = { ...current };

    if (dto.spec !== undefined) {
      next.spec = dto.spec as AutomationRule['spec'];
      next.specSource = 'user';
      next.specVersion = TRANSLATOR_VERSION;
      // A spec written here is held to the same bar as a translated one: a
      // rule whose actions are all `unsupported` (email, in-app, tag,
      // sub-status) would fire and do nothing, so it stays not runnable and
      // cannot be switched on.
      next.runnable = hasExecutableAction(next.spec?.actions);
      if (next.runnable) delete next.notRunnableReason;
      else next.notRunnableReason = NOTHING_EXECUTABLE_REASON;
    }
    if (dto.enabled === true && !next.builtin && !(next.spec && next.runnable !== false)) {
      throw new RuleNotRunnableException(id, next.notRunnableReason);
    }

    const at = new Date().toISOString();
    const saved = await this.repository.put({
      ...next,
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      updatedAt: at,
      updatedBy: caller.id,
      createdBy: current.createdBy ?? caller.id,
    });
    this.logger.log(`Automation rule ${id} updated by ${caller.id}: ${Object.keys(dto).join(', ')}`);
    return saved;
  }

  /**
   * `POST /automations/migrate` — writes the translation of every imported
   * rule to its row, so specs stop being recomputed on every read and can
   * be edited. Idempotent, and it never touches a rule somebody edited by
   * hand or one already on the current translator version. Returns the
   * coverage table, busiest Workiz rule first.
   */
  async migrate(caller: { id: string }, opts: { dryRun?: boolean } = {}): Promise<AutomationMigrationRow[]> {
    const rows: AutomationMigrationRow[] = [];
    for (const stored of await this.repository.list()) {
      if (isBuiltinRuleId(stored.id) || stored.specSource === 'user') continue;
      const translated = this.overlay(stored);
      const upToDate = stored.specSource === 'workiz-translator' && stored.specVersion === TRANSLATOR_VERSION;
      const written = !upToDate && !opts.dryRun;
      if (written) {
        await this.repository.put({ ...translated, updatedAt: new Date().toISOString(), updatedBy: caller.id });
      }
      rows.push({
        id: translated.id,
        name: translated.name,
        runnable: translated.runnable === true,
        reason: translated.notRunnableReason,
        trigger: translated.spec?.trigger.kind,
        actions: (translated.spec?.actions ?? []).map((a) => `${a.type}${a.to ? `:${a.to}` : ''}`),
        workizEnabled: stored.workizEnabled,
        workizTriggered: stored.workizTriggered,
        written,
      });
    }
    this.logger.log(
      `Automation migration by ${caller.id}: ${rows.filter((r) => r.runnable).length}/${rows.length} runnable` +
        `${opts.dryRun ? ' (dry run)' : ''}`,
    );
    return rows.sort(
      (a, b) => (b.workizTriggered ?? 0) - (a.workizTriggered ?? 0) || a.name.localeCompare(b.name),
    );
  }

  /**
   * A stored built-in row keeps the code-level description/trigger; the row
   * wins on state and name. An imported row without a hand-written spec is
   * translated on the way out.
   */
  private overlay(stored: AutomationRule): AutomationRule {
    if (isBuiltinRuleId(stored.id)) return { ...BUILTIN_RULES[stored.id], ...stored, builtin: true };
    return this.withSpec(stored);
  }

  /** The translation, unless the row already carries a current or hand-written one. */
  private withSpec(rule: AutomationRule): AutomationRule {
    if (rule.specSource === 'user') return rule;
    if (rule.specSource === 'workiz-translator' && rule.specVersion === TRANSLATOR_VERSION) return rule;
    if (!rule.events && !rule.conditions && !rule.spec) return rule;

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
}

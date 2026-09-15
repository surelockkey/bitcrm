import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type AutomationRule, type BuiltinAutomationRuleId } from '@bitcrm/types';
import { AutomationsRepository } from './automations.repository';
import { BUILTIN_RULES, isBuiltinRuleId } from './builtin-rules';
import { type UpdateAutomationDto } from './dto/update-automation.dto';

/**
 * Raised when a rule the service has no engine for is switched on: the 80
 * imported Workiz rules are data until the rule engine lands (design §10,
 * the L half of M21). Its own class so the filter's message carries the
 * code the settings page switches on.
 */
export class RuleNotRunnableException extends HttpException {
  constructor(ruleId: string) {
    super(
      `RULE_NOT_RUNNABLE: automation rule ${ruleId} is imported data; only built-in rules can be enabled yet`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * Rules as data (M21): the stored rows plus the built-in defaults for any
 * built-in rule nobody has edited yet — so `GET /automations` always shows
 * the three the service runs, seed-free, next to whatever the history
 * loader imported.
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
   * `PATCH /automations/:id` — enable / disable / rename. Whole-document
   * write over what is stored (or over the built-in default on first edit).
   * Enabling an imported rule is refused: nothing would run it.
   */
  async update(id: string, dto: UpdateAutomationDto, caller: { id: string }): Promise<AutomationRule> {
    const current = await this.get(id);
    if (dto.enabled === true && !current.builtin) throw new RuleNotRunnableException(id);

    const at = new Date().toISOString();
    const next: AutomationRule = {
      ...current,
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      updatedAt: at,
      updatedBy: caller.id,
      createdBy: current.createdBy ?? caller.id,
    };
    const saved = await this.repository.put(next);
    this.logger.log(`Automation rule ${id} updated by ${caller.id}: ${Object.keys(dto).join(', ')}`);
    return saved;
  }

  /** A stored built-in row keeps the code-level description/trigger; the row wins on state and name. */
  private overlay(stored: AutomationRule): AutomationRule {
    if (!isBuiltinRuleId(stored.id)) return stored;
    return { ...BUILTIN_RULES[stored.id], ...stored, builtin: true };
  }
}

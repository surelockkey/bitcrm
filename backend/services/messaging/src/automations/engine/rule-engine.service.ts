import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_TIMEZONE,
  type AutomationRule,
  type AutomationRun,
  type AutomationRunAction,
  type AutomationRunOutcome,
  type AutomationSpec,
  type MessagingSettings,
} from '@bitcrm/types';
import { MessagingSettingsService } from '../../settings/messaging-settings.service';
import { dueMinuteOf } from '../automations.constants';
import { AutomationsService } from '../automations.service';
import { AutomationPeersClient, type AutomationDeal } from '../internal/peers.client';
import {
  isOutsideWorkingHours,
  isWithinQuietHours,
  quietHoursEnd,
  workingHoursStart,
} from '../quiet-hours';
import { AutomationActionExecutor, type ActionContext } from './action-executor';
import { dueInstant } from './anchor';
import { AutomationRunsRepository } from './automation-runs.repository';
import { evaluateRule, matchesConditions } from './evaluator';
import { type AutomationDealFacts, type AutomationFacts } from './facts';
import { AutomationScheduleRepository, type ScheduledFiring } from './schedule.repository';
import { entityOf, occurrenceOf, type AutomationEvent } from './trigger-event';

/** Rules are re-read this often; a rule switched on in the UI takes effect within it. */
export const RULE_CACHE_TTL_MS = 15_000;
/** How far back a tick catches up after a restart (minutes). */
export const SCHEDULER_LOOKBACK_MINUTES = 180;
/** Nothing is armed for a moment that has already passed by more than this. */
export const RELATIVE_ARM_GRACE_MINUTES = 2;

const MINUTE_MS = 60_000;

/**
 * The rule engine (design §10 M21 L). One entry point per source:
 *
 *   handle(event, facts?)  an event arrived (a job event, a call, a message):
 *                          evaluate every enabled rule, run or arm what fired
 *   tick(now)              the minute poller: run what was armed for the
 *                          minutes that have passed
 *   testRun(ruleId, deal)  the Automation Center's "test against a job":
 *                          the same path with nothing sent
 *
 * Firing a rule is always: evaluate (pure) → decide *when* (delay, quiet
 * hours, the rule's own window) → claim the occurrence → act → log. The
 * claim is what makes an SQS redelivery, two instances, or a replayed
 * queue send one message; it is taken immediately before acting, or, for a
 * firing that has to wait, before the timer is armed.
 */
@Injectable()
export class AutomationRuleEngine {
  private readonly logger = new Logger(AutomationRuleEngine.name);
  private cache?: { rules: AutomationRule[]; expiresAt: number };
  /** Minute bucket the poller has already worked through (epoch ms of its start). */
  private lastMinuteMs?: number;

  constructor(
    private readonly rules: AutomationsService,
    private readonly settings: MessagingSettingsService,
    private readonly peers: AutomationPeersClient,
    private readonly runs: AutomationRunsRepository,
    private readonly schedule: AutomationScheduleRepository,
    private readonly executor: AutomationActionExecutor,
  ) {}

  // ------------------------------------------------------------------ events

  /**
   * Every enabled rule against one event. `facts` is passed in by the
   * consumer that already read the job; otherwise the job is read here.
   * Never throws for one bad rule — the others still run.
   */
  async handle(event: AutomationEvent, facts?: AutomationFacts, now: Date = new Date()): Promise<AutomationRun[]> {
    const rules = await this.enabledRules();
    if (!rules.length) return [];

    const resolved = facts ?? (await this.factsFor(event));
    const enriched = this.enrich(event, resolved);
    const settings = await this.settings.get();

    const out: AutomationRun[] = [];
    for (const rule of rules) {
      try {
        const run = await this.applyRule(rule, enriched, resolved, settings, now);
        if (run) out.push(run);
      } catch (error) {
        this.logger.error(
          `Rule ${rule.id} failed on ${event.kind}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    await this.armRelative(rules, enriched, resolved, settings, now);
    return out;
  }

  private async applyRule(
    rule: AutomationRule,
    event: AutomationEvent,
    facts: AutomationFacts,
    settings: MessagingSettings,
    now: Date,
  ): Promise<AutomationRun | null> {
    const decision = evaluateRule(rule, event, facts, now);
    if (!decision.fired) return null;

    const spec = rule.spec as AutomationSpec;
    const placement = this.placement(spec, settings, new Date(decision.dueAt), decision.delayed);

    if (placement.kind === 'skip') {
      return this.log(rule, event, decision.entity, decision.occurrence, 'skipped', [], { reason: placement.reason });
    }

    // The claim is taken before anything is done or armed — one firing, one claim.
    const claimed = await this.runs.claim(rule.id, decision.entity, decision.occurrence, now.toISOString());
    if (!claimed) {
      this.logger.debug(`Rule ${rule.id} already handled ${decision.entity} / ${decision.occurrence}`);
      return null;
    }

    if (placement.kind === 'later') {
      return this.armLater(rule, event, decision.entity, decision.occurrence, placement.dueAt, placement.reason, now);
    }
    return this.execute(rule, event, facts, decision.entity, decision.occurrence, now);
  }

  /** Where a firing goes: now, later, or nowhere. */
  private placement(
    spec: AutomationSpec,
    settings: MessagingSettings,
    dueAt: Date,
    delayed: boolean,
  ): { kind: 'now' } | { kind: 'later'; dueAt: string; reason: ScheduledFiring['reason'] } | { kind: 'skip'; reason: string } {
    if (delayed) return { kind: 'later', dueAt: dueAt.toISOString(), reason: 'delay' };

    const mode = spec.timing?.quietHours ?? 'hold';
    if (mode === 'ignore') return { kind: 'now' };

    const timezone = this.timezone(settings);
    const quiet = isWithinQuietHours(settings.quietHours, dueAt);
    const shut = isOutsideWorkingHours(spec.timing?.workingHours, timezone, dueAt);
    if (!quiet && !shut) return { kind: 'now' };
    if (mode === 'skip') {
      return { kind: 'skip', reason: quiet ? 'inside quiet hours' : "outside the rule's working hours" };
    }

    const release = Math.max(
      quiet ? quietHoursEnd(settings.quietHours, dueAt).getTime() : 0,
      shut ? workingHoursStart(spec.timing?.workingHours, timezone, dueAt).getTime() : 0,
    );
    return {
      kind: 'later',
      dueAt: new Date(release).toISOString(),
      reason: quiet ? 'quiet_hours' : 'working_hours',
    };
  }

  // --------------------------------------------------------------- scheduler

  private async armLater(
    rule: AutomationRule,
    event: AutomationEvent,
    entity: string,
    occurrence: string,
    dueAt: string,
    reason: ScheduledFiring['reason'],
    now: Date,
    anchorAt?: string,
  ): Promise<AutomationRun> {
    const firing: ScheduledFiring = {
      ruleId: rule.id,
      entity,
      occurrence,
      dueAt,
      dealId: event.dealId,
      reason,
      event: JSON.stringify(event),
      ...(anchorAt ? { anchorAt } : {}),
      createdAt: now.toISOString(),
    };
    try {
      await this.schedule.arm(firing);
    } catch (error) {
      // Nothing ran and nothing is waiting: give the claim back so the next
      // delivery of the same event can try again.
      await this.runs.release(rule.id, entity, occurrence).catch(() => undefined);
      throw error;
    }
    this.logger.log(`Rule ${rule.id} armed for ${dueMinuteOf(dueAt)} (${reason})`);
    return this.log(rule, event, entity, occurrence, 'scheduled', [], { dueAt, countsAsFiring: false });
  }

  /**
   * Relative reminders ("1 hour before the job"): armed by whatever job
   * event we just saw, once the rule's conditions hold. A reschedule gives
   * a new anchor and therefore a new timer; the stale one is skipped when
   * its minute comes because the job no longer matches its `anchorAt`.
   */
  private async armRelative(
    rules: AutomationRule[],
    event: AutomationEvent,
    facts: AutomationFacts,
    settings: MessagingSettings,
    now: Date,
  ): Promise<void> {
    if (!facts.deal || event.kind === 'schedule.relative') return;
    const timezone = this.timezone(settings);

    for (const rule of rules) {
      const spec = rule.spec;
      if (spec?.trigger.kind !== 'schedule.relative') continue;
      if (!matchesConditions(spec.conditions ?? [], facts).matched) continue;

      const due = dueInstant(spec.trigger, facts.deal, timezone);
      if (!due) continue;
      if (due.dueAt.getTime() < now.getTime() - RELATIVE_ARM_GRACE_MINUTES * MINUTE_MS) continue;

      const timerEvent: AutomationEvent = {
        kind: 'schedule.relative',
        at: now.toISOString(),
        dealId: facts.deal.id,
        timer: {
          ruleId: rule.id,
          anchorAt: due.anchorAt.toISOString(),
          offsetMinutes: spec.trigger.offsetMinutes ?? 0,
        },
      };
      const entity = entityOf(timerEvent);
      const occurrence = occurrenceOf(timerEvent, spec.conditions ?? [], facts, 'schedule.relative');
      try {
        if (!(await this.runs.claim(rule.id, entity, occurrence, now.toISOString()))) continue;
        await this.armLater(
          rule,
          timerEvent,
          entity,
          occurrence,
          due.dueAt.toISOString(),
          'relative',
          now,
          due.anchorAt.toISOString(),
        );
      } catch (error) {
        this.logger.warn(
          `Rule ${rule.id} could not be armed for ${facts.deal.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  /**
   * The poller: every minute that has fully passed since the last tick is
   * read and emptied. After a restart it catches up at most
   * `SCHEDULER_LOOKBACK_MINUTES`; the minute in progress is left alone so
   * nothing fires early.
   */
  async tick(now: Date = new Date()): Promise<number> {
    const currentMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
    const earliest = currentMs - SCHEDULER_LOOKBACK_MINUTES * MINUTE_MS;
    let cursor = Math.max(this.lastMinuteMs ?? earliest, earliest);

    let fired = 0;
    for (; cursor < currentMs; cursor += MINUTE_MS) {
      const minute = dueMinuteOf(new Date(cursor).toISOString());
      let firings: ScheduledFiring[];
      try {
        firings = await this.schedule.dueIn(minute);
      } catch (error) {
        this.logger.error(`Schedule bucket ${minute} not readable: ${error instanceof Error ? error.message : error}`);
        this.lastMinuteMs = cursor; // retry this minute on the next tick
        return fired;
      }
      for (const firing of firings) {
        try {
          await this.fire(firing, now);
          fired += 1;
        } catch (error) {
          this.logger.error(
            `Scheduled firing ${firing.ruleId} / ${firing.occurrence} failed: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    }
    this.lastMinuteMs = currentMs;
    return fired;
  }

  /** One armed firing whose minute has come. */
  private async fire(firing: ScheduledFiring, now: Date): Promise<void> {
    const rule = await this.rules.find(firing.ruleId);
    const event = this.parseEvent(firing);
    if (!rule?.enabled || !rule.spec || !event) {
      await this.schedule.remove(firing);
      return;
    }

    const facts = await this.factsFor(event);
    const settings = await this.settings.get();

    // Still a rule that applies? A job canceled since must not get the follow-up.
    const conditions = matchesConditions(rule.spec.conditions ?? [], facts);
    if (!conditions.matched) {
      await this.schedule.remove(firing);
      await this.log(rule, event, firing.entity, firing.occurrence, 'skipped', [], { reason: conditions.reason });
      return;
    }

    // A reminder whose job has moved since is stale: the reschedule armed a new one.
    if (firing.anchorAt && facts.deal) {
      const due = dueInstant(rule.spec.trigger, facts.deal, this.timezone(settings));
      if (!due || due.anchorAt.toISOString() !== firing.anchorAt) {
        await this.schedule.remove(firing);
        await this.log(rule, event, firing.entity, firing.occurrence, 'skipped', [], {
          reason: 'the job was rescheduled after this reminder was armed',
        });
        return;
      }
    }

    // Quiet hours are re-checked at the moment of sending, not of arming.
    const placement = this.placement(rule.spec, settings, now, false);
    if (placement.kind === 'skip') {
      await this.schedule.remove(firing);
      await this.log(rule, event, firing.entity, firing.occurrence, 'skipped', [], { reason: placement.reason });
      return;
    }
    if (placement.kind === 'later') {
      await this.schedule.remove(firing);
      await this.schedule.arm({ ...firing, dueAt: placement.dueAt, reason: placement.reason });
      return;
    }

    await this.execute(rule, event, facts, firing.entity, firing.occurrence, now);
    await this.schedule.remove(firing);
  }

  // ----------------------------------------------------------------- running

  private async execute(
    rule: AutomationRule,
    event: AutomationEvent,
    facts: AutomationFacts,
    entity: string,
    occurrence: string,
    now: Date,
    dryRun = false,
  ): Promise<AutomationRun> {
    const actions: AutomationRunAction[] = [];
    for (const [index, action] of (rule.spec?.actions ?? []).entries()) {
      const ctx: ActionContext = { ruleId: rule.id, event, facts, entity, occurrence, index, dryRun };
      actions.push(...(await this.executor.run(action, ctx)));
    }
    return this.log(rule, event, entity, occurrence, this.outcomeOf(actions, dryRun), actions, {
      countsAsFiring: !dryRun,
      persist: !dryRun,
      now,
    });
  }

  private outcomeOf(actions: AutomationRunAction[], dryRun: boolean): AutomationRunOutcome {
    if (dryRun) return 'dry_run';
    if (!actions.length) return 'skipped';
    const sent = actions.filter((a) => a.outcome === 'sent' || a.outcome === 'duplicate').length;
    if (sent === actions.length) return actions.every((a) => a.outcome === 'duplicate') ? 'duplicate' : 'sent';
    if (sent > 0) return 'partial';
    return actions.some((a) => a.outcome === 'failed') ? 'failed' : 'skipped';
  }

  /** Writes the firing to the rule's log (and its counter); returns it either way. */
  private async log(
    rule: AutomationRule,
    event: AutomationEvent,
    entity: string,
    occurrence: string,
    outcome: AutomationRunOutcome,
    actions: AutomationRunAction[],
    opts: { reason?: string; dueAt?: string; countsAsFiring?: boolean; persist?: boolean; now?: Date } = {},
  ): Promise<AutomationRun> {
    const firedAt = (opts.now ?? new Date()).toISOString();
    const run: AutomationRun = {
      id: randomUUID(),
      ruleId: rule.id,
      firedAt,
      trigger: event.kind,
      entity,
      dealId: event.dealId,
      occurrence,
      outcome,
      actions,
      ...(opts.reason ? { reason: opts.reason } : {}),
      ...(opts.dueAt ? { dueAt: opts.dueAt } : {}),
    };
    if (opts.persist === false) return run;
    try {
      await this.runs.log(run);
      if (opts.countsAsFiring !== false) await this.runs.bump(rule.id, firedAt);
    } catch (error) {
      this.logger.warn(`Firing log for ${rule.id} not written: ${error instanceof Error ? error.message : error}`);
    }
    return run;
  }

  // ------------------------------------------------------------------ helpers

  /** A rule tried against one job with nothing sent — the Automation Center's test run. */
  async testRun(ruleId: string, dealId: string, now: Date = new Date()): Promise<AutomationRun> {
    const rule = await this.rules.get(ruleId);
    const deal = await this.peers.deal(dealId);
    const facts: AutomationFacts = deal ? { deal: this.dealFacts(deal) } : {};
    const event: AutomationEvent = {
      kind: rule.spec?.trigger.kind ?? 'deal.updated',
      at: now.toISOString(),
      dealId,
      status: { to: facts.deal?.superStatus, toSubStatusId: facts.deal?.subStatusId },
      ...(rule.spec?.trigger.kind === 'deal.tech_assigned' ? { techId: facts.deal?.assignedTechIds?.[0] } : {}),
      ...(rule.spec?.trigger.kind === 'schedule.relative'
        ? { timer: { ruleId, anchorAt: now.toISOString(), offsetMinutes: rule.spec.trigger.offsetMinutes ?? 0 } }
        : {}),
    };
    const entity = entityOf(event);
    const occurrence = `test:${now.toISOString()}`;

    if (!rule.spec) {
      return this.log(rule, event, entity, occurrence, 'skipped', [], {
        reason: rule.notRunnableReason ?? 'the rule has no runnable spec',
        persist: false,
      });
    }
    if (!deal) {
      return this.log(rule, event, entity, occurrence, 'skipped', [], { reason: 'job not found', persist: false });
    }
    const conditions = matchesConditions(rule.spec.conditions ?? [], facts);
    if (!conditions.matched) {
      return this.log(rule, event, entity, occurrence, 'skipped', [], { reason: conditions.reason, persist: false });
    }
    return this.execute(rule, event, facts, entity, occurrence, now, true);
  }

  /** Enabled, runnable rules — cached briefly; every event would otherwise list the catalog. */
  private async enabledRules(): Promise<AutomationRule[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.rules;
    const rules = (await this.rules.list()).filter((r) => r.enabled && r.spec && r.runnable !== false);
    this.cache = { rules, expiresAt: Date.now() + RULE_CACHE_TTL_MS };
    return rules;
  }

  /** Drops the rule cache — called when a rule is edited. */
  invalidate(): void {
    this.cache = undefined;
  }

  private async factsFor(event: AutomationEvent): Promise<AutomationFacts> {
    if (!event.dealId) return {};
    const deal = await this.peers.deal(event.dealId);
    return deal ? { deal: this.dealFacts(deal) } : {};
  }

  dealFacts(deal: AutomationDeal): AutomationDealFacts {
    return {
      id: deal.id,
      dealNumber: deal.dealNumber,
      contactId: deal.contactId,
      superStatus: deal.superStatus,
      subStatusId: deal.subStatusId,
      tagIds: deal.tagIds ?? [],
      sourceId: deal.sourceId,
      jobTypeId: deal.jobTypeId,
      serviceAreaId: deal.serviceAreaId,
      assignedTechIds: deal.assignedTechIds ?? [],
      assignedDispatcherId: deal.assignedDispatcherId,
      priority: deal.priority,
      paymentStatus: deal.paymentStatus,
      scheduledDate: deal.scheduledDate,
      scheduledEndDate: deal.scheduledEndDate,
      scheduledTimeSlot: deal.scheduledTimeSlot,
      statusChangedAt: deal.statusChangedAt,
      createdAt: deal.createdAt,
    };
  }

  /**
   * deal-service publishes a status change without the sub-status ids and a
   * creation without the status the job landed in; both are on the job we
   * just read, so the event is completed from it before matching.
   */
  private enrich(event: AutomationEvent, facts: AutomationFacts): AutomationEvent {
    if (!facts.deal) return event;
    if (event.kind !== 'deal.status_changed' && event.kind !== 'deal.created') return event;
    const status = { ...(event.status ?? {}) };
    status.to ??= facts.deal.superStatus;
    if (status.toSubStatusId === undefined || status.toSubStatusId === null) {
      status.toSubStatusId = facts.deal.subStatusId;
    }
    return { ...event, status };
  }

  private parseEvent(firing: ScheduledFiring): AutomationEvent | null {
    try {
      return JSON.parse(firing.event) as AutomationEvent;
    } catch {
      this.logger.warn(`Scheduled firing ${firing.ruleId} / ${firing.occurrence} carries an unreadable event`);
      return null;
    }
  }

  private timezone(settings: MessagingSettings): string {
    return settings.timezone || settings.quietHours?.timezone || DEFAULT_TIMEZONE;
  }
}

import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { PaymentsRepository } from './payments.repository';
import { StripeEventsHandler } from './stripe/stripe-events.handler';
import { StripeService } from './stripe/stripe.service';

const LOCK_KEY = 'billing:lock:payment-reconcile';
const FIRST_RUN_DELAY_MS = 90_000;

/**
 * The safety net under the webhook. Every payment still `pending` after
 * `BILLING_PAYMENT_RECONCILE_AGE_MINUTES` is re-fetched from Stripe and
 * re-asserted through the same handlers the webhook uses — so a dropped
 * delivery, a 500 we returned, or a checkout the customer walked away from
 * all resolve without anyone noticing.
 *
 * Same shape as `OverdueSweepScheduler`: every instance schedules it, a Redis
 * `SET NX EX` lock lets exactly one run it per period.
 * `BILLING_PAYMENT_RECONCILE_MINUTES=0` turns it off.
 */
@Injectable()
export class PaymentReconcileScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentReconcileScheduler.name);
  private timers: NodeJS.Timeout[] = [];
  private readonly periodMinutes = Number(process.env.BILLING_PAYMENT_RECONCILE_MINUTES ?? 15);
  private readonly minAgeMinutes = Number(process.env.BILLING_PAYMENT_RECONCILE_AGE_MINUTES ?? 20);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly handler: StripeEventsHandler,
    private readonly stripe: StripeService,
    private readonly redis: RedisService,
  ) {}

  onApplicationBootstrap(): void {
    if (!(this.periodMinutes > 0) || process.env.NODE_ENV === 'test') return;
    // Nothing to reconcile against without Stripe; the offline ledger is exact.
    if (!this.stripe.available) return;
    const run = () =>
      void this.runOnce().catch((err: Error) => this.logger.warn(`payment reconcile failed: ${err.message}`));
    const first = setTimeout(run, FIRST_RUN_DELAY_MS);
    const every = setInterval(run, this.periodMinutes * 60_000);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Runs the sweep if this instance wins the lock; `null` when it didn't. */
  async runOnce(): Promise<number | null> {
    const ttlSeconds = Math.max(60, Math.floor(Math.max(this.periodMinutes, 1) * 60) - 5);
    const won = await this.redis.client.set(LOCK_KEY, `${process.pid}`, 'EX', ttlSeconds, 'NX');
    if (won !== 'OK') return null;
    return this.sweep();
  }

  /** Returns how many payments were re-asserted. */
  async sweep(now = Date.now()): Promise<number> {
    if (!this.stripe.available) return 0;
    const cutoff = now - this.minAgeMinutes * 60_000;
    const stale = (await this.repo.listNonTerminal()).filter(
      (p) => Date.parse(p.updatedAt || p.createdAt) < cutoff && (p.stripePaymentIntentId || p.stripeSessionId),
    );
    let changed = 0;
    for (const payment of stale) {
      try {
        const before = payment.status;
        await this.handler.reconcile(payment);
        const after = (await this.repo.get(payment.id))?.status;
        if (after && after !== before) changed++;
      } catch (err) {
        this.logger.warn(`reconciling payment ${payment.id} failed: ${(err as Error).message}`);
      }
    }
    if (changed) this.logger.log(`payment reconcile: ${changed} payment(s) re-asserted from Stripe`);
    return changed;
  }
}

import { randomUUID } from 'crypto';
import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
  JobPaymentLedger,
  PaymentSchedule,
  PaymentScheduleView,
  SavePaymentScheduleBody,
} from '@bitcrm/types';
import type { Caller } from '../common/access';
import { resolveTimezone, todayIn } from '../common/dates';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentScheduleRepository } from './payment-schedule.repository';
import { scheduleLines, validateSchedule } from './payment-schedule.rules';

/** The business's day — the account's zone, as every billing date is. */
const businessToday = () => todayIn(resolveTimezone(undefined));

/**
 * Workiz's Payment schedule. Billing keeps it per job and reads it against the
 * job's ledger (`PaymentsService.listForDeal`), which also decides who may see
 * the job (`payments`, assigned-only for a technician) and what its total is —
 * the invoice's when it has one, the job's own otherwise.
 */
@Injectable()
export class PaymentScheduleService {
  constructor(
    private readonly repo: PaymentScheduleRepository,
    private readonly payments: PaymentsService,
    private readonly invoices: InvoicesService,
    @Optional() private readonly today: () => string = businessToday,
  ) {}

  /**
   * Most jobs have no schedule, so the row is read before the ledger. It is
   * read BESIDE the ledger's own access check (`accessibleJob`, an HTTP hop
   * to deal-service) rather than after it — one round trip instead of two —
   * but the check still decides first: a caller who may not see the job gets
   * the same refusal whether or not a schedule exists (and never a read
   * error in its place), and the ledger is only built for one who may.
   */
  async get(dealId: string, caller: Caller): Promise<PaymentScheduleView | null> {
    const job$ = this.payments.accessibleJob(dealId, caller);
    const schedule$ = this.repo.get(dealId);
    schedule$.catch(() => undefined);
    const job = await job$;
    const schedule = job.deal.id === dealId ? await schedule$ : await this.repo.get(job.deal.id);
    if (!schedule) return null;
    return this.view(schedule, await this.payments.ledgerForJob(job));
  }

  /** The whole schedule, replaced. Payments keep their ids; new ones get one. */
  async save(dealId: string, body: SavePaymentScheduleBody, caller: Caller): Promise<PaymentScheduleView> {
    const ledger = await this.payments.listForDeal(dealId, caller);
    validateSchedule(body, ledger.total);
    const schedule: PaymentSchedule = {
      dealId: ledger.dealId,
      method: body.method,
      entries: body.entries.map((e) => ({
        id: e.id || randomUUID(),
        ...(body.method === 'percent' ? { percent: e.percent } : { amount: e.amount }),
        dueDate: e.dueDate,
        ...(e.note?.trim() && { note: e.note.trim() }),
      })),
      updatedAt: new Date().toISOString(),
      updatedBy: caller.user.id,
    };
    return this.view(await this.repo.put(schedule), ledger);
  }

  async remove(dealId: string, caller: Caller): Promise<void> {
    const ledger = await this.payments.listForDeal(dealId, caller);
    await this.repo.delete(ledger.dealId);
  }

  /**
   * Workiz's View on one payment: the job's invoice, its Balance due what is
   * left of that payment. The figure is worked out here, from the schedule —
   * never taken from the caller.
   */
  async pdf(dealId: string, lineId: string, download: boolean, caller: Caller): Promise<{ url: string }> {
    const ledger = await this.payments.listForDeal(dealId, caller);
    const schedule = await this.repo.get(ledger.dealId);
    const line = schedule ? this.view(schedule, ledger).lines.find((l) => l.id === lineId) : undefined;
    if (!line) throw new NotFoundException('That payment is not on the schedule');
    if (!ledger.invoiceId) throw new ConflictException('Create the invoice for this job first');
    return this.invoices.pdf(ledger.invoiceId, download, caller, { balanceDue: line.remaining });
  }

  private view(schedule: PaymentSchedule, ledger: JobPaymentLedger): PaymentScheduleView {
    return {
      dealId: ledger.dealId,
      method: schedule.method,
      total: ledger.total,
      amountPaid: ledger.amountPaid,
      balanceDue: ledger.balanceDue,
      lines: scheduleLines(schedule, { total: ledger.total, amountPaid: ledger.amountPaid, today: this.today() }),
      updatedAt: schedule.updatedAt,
    };
  }
}

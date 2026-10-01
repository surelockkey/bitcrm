/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PaymentRefund } from '@bitcrm/types';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentSettingsService } from 'src/payments/payment-settings.service';
import { StripeEventsHandler } from 'src/payments/stripe/stripe-events.handler';
import { billingView, caller, dealProduct, mockCrmClient, mockDealClient, mockEvents } from './mocks';
import { fakeInvoices, fakeLedger, invoice, mockStripeService, payment } from './payment-mocks';

/**
 * Every ledger change must reach the Payments report: `syncLedger` is the one
 * place a change is propagated, so the report projector hangs off it — plus
 * the refund webhook, which updates a refund row without re-totalling.
 */
function build(seed: ReturnType<typeof payment>[] = []) {
  const ledger = fakeLedger(seed);
  const invoices = fakeInvoices(invoice({ id: 'deal-other', dealId: 'deal-other' }), ledger);
  const deal = mockDealClient();
  deal.getBillingView.mockImplementation(async (id: string) =>
    id === 'deal-1'
      ? billingView(
          { taxRatePercent: 0, taxSource: 'exempt' as any, assignedTechIds: ['tech-lead', 'tech-2'], serviceAreaId: 'area-ct' },
          [dealProduct({ quantity: 1, priceClient: 150, taxable: false })],
        )
      : null,
  );
  const report = { project: jest.fn(async () => undefined) };
  const stripe = mockStripeService();
  const service = new PaymentsService(
    ledger as any,
    invoices as any,
    new PaymentSettingsService(ledger as any) as any,
    deal as any,
    stripe as any,
    mockEvents() as any,
    mockCrmClient() as any,
    undefined,
    report as any,
  );
  return { service, ledger, report, stripe };
}

describe('Payments report hooks', () => {
  it('an offline payment remembers the job’s lead technician and area, and is projected', async () => {
    const { service, report } = build();
    const p = await service.recordOfflineForDeal('deal-1', { amount: 40, method: 'cash' }, caller());
    expect(p).toMatchObject({ technicianId: 'tech-lead', serviceAreaId: 'area-ct' });
    expect(report.project).toHaveBeenCalledWith(p.id);
  });

  it('a refund and a delete are projected too', async () => {
    const seed = payment({ id: 'wz-1', method: 'cash', source: 'office', takenBy: 'u-9', amount: 100 });
    const { service, report } = build([seed]);
    await service.refund('wz-1', { amount: 10 }, caller());
    expect(report.project).toHaveBeenLastCalledWith('wz-1');
    report.project.mockClear();
    await service.remove('wz-1', caller());
    expect(report.project).toHaveBeenCalledWith('wz-1');
  });

  it('works exactly as before without a projector (it is optional)', async () => {
    const ledger = fakeLedger();
    const deal = mockDealClient();
    deal.getBillingView.mockImplementation(async () =>
      billingView({ taxRatePercent: 0, taxSource: 'exempt' as any }, [dealProduct({ quantity: 1, priceClient: 150, taxable: false })]),
    );
    const service = new PaymentsService(
      ledger as any,
      fakeInvoices(invoice({ id: 'x', dealId: 'x' }), ledger) as any,
      new PaymentSettingsService(ledger as any) as any,
      deal as any,
    );
    await expect(service.recordOfflineForDeal('deal-1', { amount: 40, method: 'cash' }, caller())).resolves.toMatchObject({
      amount: 40,
    });
  });

  it('a Stripe refund that failed re-projects its payment', async () => {
    const seed = payment({ id: 'p1', stripePaymentIntentId: 'pi_1', refundedAmount: 20 });
    const { service, ledger, stripe } = build([seed]);
    ledger.refunds.push({
      id: 'r1',
      paymentId: 'p1',
      invoiceId: 'deal-1',
      amount: 20,
      status: 'pending',
      stripeRefundId: 're_1',
      refundedBy: 'u-1',
      createdAt: '2026-09-23T00:00:00.000Z',
      updatedAt: '2026-09-23T00:00:00.000Z',
    } as PaymentRefund);
    ledger.pointers.set('pi_1', 'p1');
    const report = { project: jest.fn(async () => undefined) };
    const handler = new StripeEventsHandler(ledger as any, service, stripe as any, report as any);
    await handler.process({
      id: 'evt_1',
      type: 'refund.failed',
      data: { object: { id: 're_1', status: 'failed', payment_intent: 'pi_1', metadata: { paymentId: 'p1' } } },
    } as any);
    expect(report.project).toHaveBeenCalledWith('p1');
  });
});

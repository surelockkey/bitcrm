/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  DEFAULT_PAYMENT_SETTINGS,
  type Invoice,
  type Payment,
  type PaymentRefund,
  type PaymentSettings,
} from '@bitcrm/types';
import { PaymentVersionConflictError } from 'src/payments/payments.repository';
import { computeInvoiceTotals, deriveInvoiceStatus } from 'src/invoices/invoice-rules';
import { amountPaidFrom } from 'src/payments/payment-rules';
import { billingView, dealProduct } from './mocks';

export const PAY_NOW = '2026-09-22T12:00:00.000Z';

export const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'pay-1',
  invoiceId: 'deal-1',
  dealId: 'deal-1',
  contactId: 'contact-1',
  amount: 100,
  currency: 'usd',
  method: 'card',
  status: 'settled',
  refundedAmount: 0,
  source: 'portal',
  takenBy: 'client',
  takenAt: PAY_NOW,
  version: 1,
  createdAt: PAY_NOW,
  updatedAt: PAY_NOW,
  ...over,
});

export const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'deal-1',
    number: 'K4T9ZW',
    dealId: 'deal-1',
    contactId: 'contact-1',
    invoiceDate: '2026-09-20',
    paymentTerms: 'net_15',
    dueDate: '2026-10-05',
    status: 'due',
    totals: computeInvoiceTotals(
      billingView({}, [dealProduct({ quantity: 1, priceClient: 100, taxable: false })]),
      { amountPaid: 0 },
    ),
    sentAt: '2026-09-20T12:00:00.000Z',
    version: 1,
    createdBy: 'u-1',
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z',
    ...over,
  }) as Invoice;

/**
 * An in-memory PaymentsRepository. Real enough to exercise the parts that
 * matter: optimistic-concurrency conflicts, the Stripe pointer lookup and the
 * webhook dedupe claim.
 */
export function fakeLedger(seed: Payment[] = []) {
  const payments = new Map<string, Payment>(seed.map((p) => [p.id, p]));
  const refunds: PaymentRefund[] = [];
  const pointers = new Map<string, string>();
  const claimed = new Set<string>();
  let settings: PaymentSettings = { ...DEFAULT_PAYMENT_SETTINGS };

  const repo = {
    payments,
    refunds,
    pointers,
    claimed,
    create: jest.fn(async (p: Payment) => {
      if (payments.has(p.id)) throw new Error('exists');
      payments.set(p.id, { ...p });
      return p;
    }),
    get: jest.fn(async (id: string) => {
      const p = payments.get(id);
      return p ? { ...p } : null;
    }),
    listByInvoice: jest.fn(async (invoiceId: string) =>
      [...payments.values()].filter((p) => p.invoiceId === invoiceId).map((p) => ({ ...p })),
    ),
    update: jest.fn(
      async (
        ref: Pick<Payment, 'id' | 'invoiceId' | 'createdAt' | 'version'>,
        set: Record<string, unknown>,
        remove: string[] = [],
        opts: { expectedVersion?: number } = {},
      ) => {
        const current = payments.get(ref.id);
        if (!current) throw new PaymentVersionConflictError();
        if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) {
          throw new PaymentVersionConflictError();
        }
        const next: any = { ...current, ...set, version: current.version + 1 };
        for (const key of remove) delete next[key];
        for (const [k, v] of Object.entries(set)) if (v === null) delete next[k];
        payments.set(ref.id, next);
        return { ...next };
      },
    ),
    delete: jest.fn(async (ref: Pick<Payment, 'id'>) => {
      payments.delete(ref.id);
    }),
    list: jest.fn(async (filter: any) => ({
      items: [...payments.values()]
        .filter((p) => (!filter.status || p.status === filter.status) && (!filter.method || p.method === filter.method))
        .filter((p) => !filter.contactId || p.contactId === filter.contactId)
        .slice(0, filter.limit),
    })),
    listNonTerminal: jest.fn(async () => [...payments.values()].filter((p) => p.status === 'pending')),
    addRefund: jest.fn(async (r: PaymentRefund) => {
      refunds.push(r);
      return r;
    }),
    listRefunds: jest.fn(async (paymentId: string) => refunds.filter((r) => r.paymentId === paymentId)),
    updateRefund: jest.fn(async () => undefined),
    putStripePointer: jest.fn(async (objectId: string, paymentId: string) => {
      pointers.set(objectId, paymentId);
    }),
    findPaymentIdByStripeObject: jest.fn(async (objectId: string) => pointers.get(objectId) ?? null),
    claimWebhookEvent: jest.fn(async (eventId: string) => {
      if (claimed.has(eventId)) return false;
      claimed.add(eventId);
      return true;
    }),
    releaseWebhookEvent: jest.fn(async (eventId: string) => {
      claimed.delete(eventId);
    }),
    getSettings: jest.fn(async () => ({ ...settings })),
    putSettings: jest.fn(async (s: PaymentSettings) => {
      settings = { ...s };
      return { ...s };
    }),
  };
  // Declared after `repo` so it can page through it without a circular type.
  (repo as any).listAllMatching = jest.fn(
    async (filter: any): Promise<Payment[]> => (await repo.list({ ...filter, limit: 10_000 })).items,
  );
  return repo as typeof repo & { listAllMatching: jest.Mock };
}

export type FakeLedger = ReturnType<typeof fakeLedger>;

/**
 * An InvoicesService stand-in that re-derives its totals and status from the
 * ledger exactly as the real one does, so a spec can assert the invoice moved.
 */
export function fakeInvoices(seed: Invoice = invoice(), ledger?: FakeLedger) {
  let stored: Invoice = { ...seed };
  return {
    get stored() {
      return stored;
    },
    getStored: jest.fn(async (id: string) => (id === stored.id ? { ...stored } : null)),
    applyAmountPaid: jest.fn(async (invoiceId: string, amountPaid: number) => {
      if (invoiceId !== stored.id) return null;
      const view = billingView({}, [dealProduct({ quantity: 1, priceClient: 100, taxable: false })]);
      const totals = computeInvoiceTotals(view, { amountPaid });
      stored = {
        ...stored,
        totals,
        status: deriveInvoiceStatus({ totals, dueDate: stored.dueDate, today: '2026-09-22' }),
      };
      return { ...stored };
    }),
    setAllowedMethods: jest.fn(async () => ({ ...stored })),
    ledgerAmountPaid: jest.fn(async (id: string) => (ledger ? amountPaidFrom(await ledger.listByInvoice(id)) : 0)),
  };
}

export function mockStripeService(over: Record<string, unknown> = {}) {
  return {
    available: true,
    onlineReady: true,
    publishableKey: 'pk_test_123',
    configured: { secretKey: true, webhookSecret: true, publishableKey: true },
    createCheckoutSession: jest.fn(async () => ({
      sessionId: 'cs_test_1',
      clientSecret: 'cs_test_1_secret',
      paymentIntentId: 'pi_test_1',
    })),
    retrieveSession: jest.fn(async () => ({ id: 'cs_test_1', payment_status: 'paid' })),
    retrievePaymentIntent: jest.fn(async () => ({ id: 'pi_test_1', status: 'succeeded' })),
    createRefund: jest.fn(async () => ({ id: 're_test_1', status: 'succeeded' })),
    expireSession: jest.fn(async () => undefined),
    constructEvent: jest.fn(),
    ...over,
  };
}

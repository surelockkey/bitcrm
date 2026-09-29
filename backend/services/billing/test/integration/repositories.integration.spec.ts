import {
  DEFAULT_BUSINESS_PROFILE,
  PaymentTerms,
  calculateDocumentTotals,
  type BusinessProfile,
  type DocumentTemplate,
  type Estimate,
  type EstimateItem,
  type Invoice,
  type Payment,
  type PaymentRefund,
} from '@bitcrm/types';
import { BILLING_TABLE } from 'src/common/constants/dynamo.constants';
import { InvoiceExistsError, InvoiceVersionConflictError, InvoicesRepository } from 'src/invoices/invoices.repository';
import { EstimatesRepository } from 'src/estimates/estimates.repository';
import { TemplateVersionConflictError, TemplatesRepository } from 'src/templates/templates.repository';
import { PortalRepository } from 'src/portal/portal.repository';
import { BusinessProfileRepository } from 'src/business-profile/business-profile.repository';
import { PaymentVersionConflictError, PaymentsRepository } from 'src/payments/payments.repository';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { BILLING_TEST_TABLE, destroyRawClient, resetTable, testDynamo } from './setup';

const totals = (total: number) => calculateDocumentTotals({ lines: [{ quantity: 1, priceClient: total }] });

const invoice = (id: string, over: Partial<Invoice> = {}): Invoice => ({
  id,
  number: id.toUpperCase(),
  dealId: id,
  contactId: 'c1',
  invoiceDate: '2026-09-16',
  paymentTerms: PaymentTerms.CASH,
  dueDate: '2026-09-16',
  status: 'due',
  totals: totals(100),
  version: 1,
  createdBy: 'u1',
  createdAt: `2026-09-${id.slice(-2)}T10:00:00.000Z`,
  updatedAt: '2026-09-16T10:00:00.000Z',
  ...over,
});

describe('billing repositories (integration)', () => {
  const dynamo = testDynamo();
  const invoices = new InvoicesRepository(dynamo);
  const estimates = new EstimatesRepository(dynamo);
  const templates = new TemplatesRepository(dynamo);
  const portal = new PortalRepository(dynamo);
  const profiles = new BusinessProfileRepository(dynamo);
  const payments = new PaymentsRepository(dynamo);

  beforeAll(() => {
    expect(BILLING_TABLE).toBe(BILLING_TEST_TABLE);
  });
  beforeEach(() => resetTable());
  afterAll(() => destroyRawClient());

  describe('invoices', () => {
    it('create is conditional (one per job)', async () => {
      await invoices.create(invoice('d-01'));
      await expect(invoices.create(invoice('d-01'))).rejects.toBeInstanceOf(InvoiceExistsError);
      expect((await invoices.get('d-01'))?.number).toBe('D-01');
    });

    it('update bumps version, removes attrs and honours expectedVersion', async () => {
      await invoices.create(invoice('d-01', { notes: 'hi' }));
      const u = await invoices.update('d-01', { sentAt: 'x', updatedAt: 'y' }, ['notes'], 1);
      expect(u.version).toBe(2);
      expect(u.notes).toBeUndefined();
      expect((u as unknown as Record<string, unknown>).PK).toBeUndefined();
      await expect(invoices.update('d-01', { updatedAt: 'z' }, [], 1)).rejects.toBeInstanceOf(
        InvoiceVersionConflictError,
      );
    });

    it('a snapshot write can leave the version alone', async () => {
      await invoices.create(invoice('d-01'));
      const u = await invoices.update('d-01', { status: 'overdue' }, [], undefined, { bumpVersion: false });
      expect(u).toMatchObject({ status: 'overdue', version: 1 });
      expect((await invoices.update('d-01', { notes: 'n' }, [], 1)).version).toBe(2);
    });

    it('lists newest first with status/unsent/date filters, contact index and exact cursors', async () => {
      await invoices.create(invoice('d-01'));
      await invoices.create(invoice('d-02', { status: 'paid' }));
      await invoices.create(invoice('d-03', { sentAt: '2026-09-03T00:00:00Z' }));
      await invoices.create(invoice('d-04', { contactId: 'c2' }));

      const all = await invoices.list({ limit: 10 });
      expect(all.items.map((i) => i.id)).toEqual(['d-04', 'd-03', 'd-02', 'd-01']);

      const due = await invoices.list({ status: 'due', limit: 2 });
      expect(due.items.map((i) => i.id)).toEqual(['d-04', 'd-03']);
      const next = await invoices.list({ status: 'due', limit: 2, cursor: due.nextCursor });
      expect(next.items.map((i) => i.id)).toEqual(['d-01']);

      const unsent = await invoices.list({ unsent: true, limit: 10 });
      expect(unsent.items.map((i) => i.id)).toEqual(['d-04', 'd-02', 'd-01']);

      const ranged = await invoices.list({ from: '2026-09-02', to: '2026-09-03', limit: 10 });
      expect(ranged.items.map((i) => i.id)).toEqual(['d-03', 'd-02']);

      const byContact = await invoices.list({ contactId: 'c2', limit: 10 });
      expect(byContact.items.map((i) => i.id)).toEqual(['d-04']);

      const overdue = await invoices.listAll({
        expression: '#status = :due AND #dueDate < :today',
        names: { '#status': 'status', '#dueDate': 'dueDate' },
        values: { ':due': 'due', ':today': '2026-09-20' },
      });
      expect(overdue.map((i) => i.id).sort()).toEqual(['d-01', 'd-03', 'd-04']);
    });
  });

  describe('estimates', () => {
    const est = (id: string, dealId = 'deal-1', over: Partial<Estimate> = {}): Estimate => ({
      id,
      number: `N-${id}`,
      dealId,
      dealNumber: 'N',
      contactId: 'c1',
      status: 'unsent',
      estimateDate: '2026-09-16',
      totals: totals(0),
      version: 1,
      createdBy: 'u1',
      createdAt: `2026-09-16T10:00:0${id.slice(-1)}.000Z`,
      updatedAt: '2026-09-16T10:00:00.000Z',
      ...over,
    });
    const item = (estimateId: string, lineId: string, position: number): EstimateItem => ({
      lineId,
      estimateId,
      position,
      productId: 'p',
      name: lineId,
      sku: 's',
      quantity: 1,
      priceClient: 10,
      costCompany: 1,
      costForTech: 1,
      taxable: true,
      createdAt: '2026-09-16T10:00:00.000Z',
      updatedAt: '2026-09-16T10:00:00.000Z',
    });

    it('hands out an increasing per-job sequence', async () => {
      expect(await estimates.nextSeq('deal-1')).toBe(1);
      expect(await estimates.nextSeq('deal-1')).toBe(2);
      expect(await estimates.nextSeq('deal-2')).toBe(1);
      await estimates.deleteCounter('deal-1');
      expect(await estimates.nextSeq('deal-1')).toBe(1);
    });

    it('stores lines in the estimate partition, ordered by position', async () => {
      await estimates.create(est('e1'), [item('e1', 'b', 1), item('e1', 'a', 0)]);
      const got = await estimates.get('e1');
      expect(got?.items.map((i) => i.lineId)).toEqual(['a', 'b']);
      await estimates.setPositions('e1', [{ lineId: 'a', position: 1 }, { lineId: 'b', position: 0 }], 'now');
      expect((await estimates.get('e1'))?.items.map((i) => i.lineId)).toEqual(['b', 'a']);
      await estimates.deleteItem('e1', 'a');
      expect((await estimates.get('e1'))?.items).toHaveLength(1);
    });

    it('lists by job, contact and status, and deletes with lines', async () => {
      await estimates.create(est('e1'), [item('e1', 'a', 0)]);
      await estimates.create(est('e2', 'deal-1', { status: 'won' }), []);
      await estimates.create(est('e3', 'deal-2', { contactId: 'c9' }), []);
      expect((await estimates.listByDeal('deal-1')).map((e) => e.id).sort()).toEqual(['e1', 'e2']);
      expect((await estimates.list({ contactId: 'c9', limit: 10 })).items.map((e) => e.id)).toEqual(['e3']);
      expect((await estimates.list({ status: 'won', limit: 10 })).items.map((e) => e.id)).toEqual(['e2']);
      expect((await estimates.list({ dealId: 'deal-1', limit: 10 })).items).toHaveLength(2);
      // The summary filters a technician's rows by job, so the job id must be read.
      expect((await estimates.listAll()).map((e) => [e.id, e.dealId, e.status]).sort()).toEqual([
        ['e1', 'deal-1', 'unsent'],
        ['e2', 'deal-1', 'won'],
        ['e3', 'deal-2', 'unsent'],
      ]);

      await estimates.delete('e1');
      expect(await estimates.get('e1')).toBeNull();
    });

    it('moving an estimate to another contact moves its contact-index entry', async () => {
      const e = est('e1');
      await estimates.create(e, []);
      await estimates.update('e1', { contactId: 'c2', createdAt: e.createdAt });
      expect((await estimates.list({ contactId: 'c1', limit: 10 })).items).toEqual([]);
      expect((await estimates.list({ contactId: 'c2', limit: 10 })).items.map((x) => x.id)).toEqual(['e1']);
    });
  });

  describe('templates', () => {
    const tpl = (id: string, over: Partial<DocumentTemplate> = {}): DocumentTemplate =>
      ({
        id,
        name: id,
        kind: 'invoice',
        isDefault: false,
        version: 1,
        page: { size: 'letter' },
        header: [],
        body: [],
        footer: [],
        visibility: {},
        createdBy: 'u',
        createdAt: '2026-09-16T00:00:00.000Z',
        updatedAt: '2026-09-16T00:00:00.000Z',
        ...over,
      }) as unknown as DocumentTemplate;

    it('seeds idempotently, replaces with a version check, swaps the default', async () => {
      expect(await templates.createIfAbsent(tpl('a', { isDefault: true }))).toBe(true);
      expect(await templates.createIfAbsent(tpl('a'))).toBe(false);
      await templates.createIfAbsent(tpl('b'));

      await templates.replace({ ...tpl('b'), name: 'B2', version: 2 }, 1);
      await expect(templates.replace({ ...tpl('b'), version: 3 }, 1)).rejects.toBeInstanceOf(
        TemplateVersionConflictError,
      );

      await templates.setDefault('b', ['a'], 'now');
      const list = await templates.list();
      expect(list.find((t) => t.id === 'a')?.isDefault).toBe(false);
      expect(list.find((t) => t.id === 'b')?.isDefault).toBe(true);

      await templates.delete('a');
      expect(await templates.get('a')).toBeNull();
    });
  });

  describe('portal', () => {
    it('regenerating swaps the token row atomically', async () => {
      await portal.saveLink({ contactId: 'c1', tokenHash: 'h1', createdBy: 'u', createdAt: 't' });
      expect(await portal.findContactByTokenHash('h1')).toBe('c1');
      await portal.saveLink({ contactId: 'c1', tokenHash: 'h2', createdBy: 'u', createdAt: 't2' }, 'h1');
      expect(await portal.findContactByTokenHash('h1')).toBeNull();
      expect(await portal.findContactByTokenHash('h2')).toBe('c1');
      await portal.touchViewed('c1', 'seen');
      expect((await portal.getLink('c1'))?.lastViewedAt).toBe('seen');
      await portal.deleteLink('c1', 'h2');
      expect(await portal.getLink('c1')).toBeNull();
      expect(await portal.findContactByTokenHash('h2')).toBeNull();
    });
  });
  describe('payments', () => {
    const pay = (id: string, over: Partial<Payment> = {}): Payment => ({
      id,
      invoiceId: 'd-01',
      dealId: 'd-01',
      contactId: 'c1',
      amount: 50,
      currency: 'usd',
      method: 'card',
      status: 'settled',
      refundedAmount: 0,
      source: 'portal',
      takenBy: 'client',
      takenAt: `2026-09-2${id.slice(-1)}T10:00:00.000Z`,
      version: 1,
      createdAt: `2026-09-2${id.slice(-1)}T10:00:00.000Z`,
      updatedAt: `2026-09-2${id.slice(-1)}T10:00:00.000Z`,
      ...over,
    });

    it('writes both copies in one transaction and reads the ledger next to its invoice', async () => {
      await payments.create(pay('p-1'));
      await payments.create(pay('p-2', { amount: 25, status: 'pending', method: 'bank' }));

      expect((await payments.get('p-1'))?.amount).toBe(50);
      const ledger = await payments.listByInvoice('d-01');
      expect(ledger.map((p) => p.id)).toEqual(['p-1', 'p-2']);
      // Storage plumbing never leaks into the entity.
      expect((ledger[0] as unknown as Record<string, unknown>).PK).toBeUndefined();
    });

    it('updates BOTH copies atomically and honours expectedVersion', async () => {
      const created = await payments.create(pay('p-1'));
      const updated = await payments.update(created, { status: 'reversed', reversedAt: 'now' });
      expect(updated.status).toBe('reversed');
      expect(updated.version).toBe(2);
      // The adjacency row moved with it — a stale copy would silently
      // resurrect reversed money in the invoice's ledger read.
      expect((await payments.listByInvoice('d-01'))[0].status).toBe('reversed');

      await expect(payments.update(created, { status: 'settled' }, [], { expectedVersion: 1 })).rejects.toBeInstanceOf(
        PaymentVersionConflictError,
      );
    });

    it('deletes both copies', async () => {
      const created = await payments.create(pay('p-1'));
      await payments.delete(created);
      expect(await payments.get('p-1')).toBeNull();
      expect(await payments.listByInvoice('d-01')).toEqual([]);
    });

    it('lists newest first through GSI1 and filters, and by contact through GSI2', async () => {
      await payments.create(pay('p-1'));
      await payments.create(pay('p-2', { status: 'pending', method: 'bank' }));
      await payments.create(pay('p-3', { contactId: 'c2', method: 'cash' }));

      const all = await payments.list({ limit: 10 });
      expect(all.items.map((p) => p.id)).toEqual(['p-3', 'p-2', 'p-1']);
      expect((await payments.list({ limit: 10, status: 'pending' })).items.map((p) => p.id)).toEqual(['p-2']);
      expect((await payments.list({ limit: 10, method: 'cash' })).items.map((p) => p.id)).toEqual(['p-3']);
      expect((await payments.list({ limit: 10, contactId: 'c2' })).items.map((p) => p.id)).toEqual(['p-3']);
      expect((await payments.listNonTerminal()).map((p) => p.id)).toEqual(['p-2']);
      expect((await payments.listAllMatching({ status: 'settled' })).map((p) => p.id).sort()).toEqual(['p-1', 'p-3']);
    });

    it('claims a Stripe event id exactly once, and can release the claim', async () => {
      expect(await payments.claimWebhookEvent('evt_1', 'payment_intent.succeeded')).toBe(true);
      expect(await payments.claimWebhookEvent('evt_1', 'payment_intent.succeeded')).toBe(false);
      await payments.releaseWebhookEvent('evt_1');
      expect(await payments.claimWebhookEvent('evt_1', 'payment_intent.succeeded')).toBe(true);
    });

    it('resolves a payment from any Stripe object id in one read', async () => {
      await payments.putStripePointer('cs_1', 'p-1');
      await payments.putStripePointer('pi_1', 'p-1');
      expect(await payments.findPaymentIdByStripeObject('pi_1')).toBe('p-1');
      expect(await payments.findPaymentIdByStripeObject('ch_nope')).toBeNull();
    });

    it('keeps refunds under their payment', async () => {
      const refund = (id: string): PaymentRefund => ({
        id,
        paymentId: 'p-1',
        invoiceId: 'd-01',
        amount: 10,
        status: 'succeeded',
        refundedBy: 'u1',
        createdAt: `2026-09-2${id.slice(-1)}T11:00:00.000Z`,
        updatedAt: `2026-09-2${id.slice(-1)}T11:00:00.000Z`,
      });
      await payments.addRefund(refund('r-1'));
      await payments.addRefund(refund('r-2'));
      const rows = await payments.listRefunds('p-1');
      expect(rows.map((r) => r.id)).toEqual(['r-1', 'r-2']);
      await payments.updateRefund(rows[0], { status: 'failed' });
      expect((await payments.listRefunds('p-1'))[0].status).toBe('failed');
    });

    it('falls back to DEFAULT_PAYMENT_SETTINGS until a row is saved', async () => {
      const defaults = await payments.getSettings();
      expect(defaults.onlinePaymentsEnabled).toBe(false);
      expect(defaults.surchargePercent).toBe(0);
      await payments.putSettings({ ...defaults, bankEnabled: true, bankMinimum: 25 });
      const saved = await payments.getSettings();
      expect(saved).toMatchObject({ bankEnabled: true, bankMinimum: 25, cardEnabled: true });
      expect((saved as unknown as Record<string, unknown>).PK).toBeUndefined();
    });
  });

  describe('business profiles', () => {
    const bp = (id: string, over: Partial<BusinessProfile> = {}): BusinessProfile => ({
      ...DEFAULT_BUSINESS_PROFILE,
      id,
      name: id,
      isDefault: false,
      active: true,
      createdAt: `2026-09-16T10:00:0${id.slice(-1)}.000Z`,
      ...over,
    });

    it('creates (conditionally), lists via the GSI, replaces and deletes', async () => {
      await profiles.create(bp('bp-1', { isDefault: true }));
      await expect(profiles.create(bp('bp-1'))).rejects.toThrow();
      await profiles.create(bp('bp-2', { phone: '+1' }));
      expect((await profiles.list()).map((p) => p.id).sort()).toEqual(['bp-1', 'bp-2']);

      await profiles.put({ ...bp('bp-2'), name: 'Renamed' });
      const got = await profiles.get('bp-2');
      expect(got?.name).toBe('Renamed');
      expect(got?.phone).toBeUndefined();
      expect((got as unknown as Record<string, unknown>).PK).toBeUndefined();
      await expect(profiles.put(bp('bp-missing'))).rejects.toThrow();

      await profiles.delete('bp-2');
      expect(await profiles.get('bp-2')).toBeNull();
    });

    it('swaps the default atomically and refuses an archived target', async () => {
      await profiles.create(bp('bp-1', { isDefault: true }));
      await profiles.create(bp('bp-2'));
      await profiles.create(bp('bp-3', { active: false }));
      await profiles.setDefault('bp-2', ['bp-1'], '2026-09-17T00:00:00.000Z');
      expect((await profiles.list()).filter((p) => p.isDefault).map((p) => p.id)).toEqual(['bp-2']);
      await expect(profiles.setDefault('bp-3', ['bp-2'], 'x')).rejects.toThrow();
      expect((await profiles.get('bp-2'))?.isDefault).toBe(true);
    });

    it('migrates the legacy singleton exactly once', async () => {
      await dynamo.client.send(
        new PutCommand({
          TableName: BILLING_TABLE,
          Item: { PK: 'SETTINGS', SK: 'BUSINESS_PROFILE', name: 'Legacy', defaultPaymentTerms: 'net15' },
        }),
      );
      expect((await profiles.getLegacy())?.name).toBe('Legacy');
      expect(await profiles.migrateLegacy(bp('bp-default', { name: 'Legacy', isDefault: true }))).toBe(true);
      expect(await profiles.getLegacy()).toBeNull();
      expect((await profiles.get('bp-default'))?.name).toBe('Legacy');
      expect(await profiles.migrateLegacy(bp('bp-default', { name: 'Again' }))).toBe(false);
      expect((await profiles.get('bp-default'))?.name).toBe('Legacy');
    });
  });
});

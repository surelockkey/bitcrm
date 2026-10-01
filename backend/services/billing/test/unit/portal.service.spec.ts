import { NotFoundException, HttpException } from '@nestjs/common';
import type { Estimate, Invoice } from '@bitcrm/types';
import { PortalService } from 'src/portal/portal.service';
import { PortalRateLimiter } from 'src/portal/portal-rate-limiter';
import { LegacyPortalRedirectController } from 'src/portal/public-portal.controller';
import { hashPortalToken } from 'src/portal/portal-token';
import type { StoredPortalLink } from 'src/portal/portal.repository';
import { NOW, mockCrmClient, profile, user } from './mocks';

function mockRepo() {
  const links = new Map<string, StoredPortalLink>();
  const tokens = new Map<string, string>();
  return {
    links,
    tokens,
    getLink: jest.fn(async (c: string) => links.get(c) ?? null),
    findContactByTokenHash: jest.fn(async (h: string) => tokens.get(h) ?? null),
    saveLink: jest.fn(async (link: StoredPortalLink, prev?: string) => {
      if (prev) tokens.delete(prev);
      tokens.set(link.tokenHash, link.contactId);
      links.set(link.contactId, link);
    }),
    deleteLink: jest.fn(async (c: string, h: string) => {
      tokens.delete(h);
      links.delete(c);
    }),
    touchViewed: jest.fn(async () => undefined),
  };
}

const invoice = (over: Partial<Invoice>): Invoice =>
  ({
    id: 'deal-1',
    number: 'K4T9ZW',
    dealId: 'deal-1',
    contactId: 'contact-1',
    invoiceDate: '2026-09-16',
    dueDate: '2026-09-30',
    status: 'due',
    totals: { total: 100, balanceDue: 100 },
    createdAt: NOW,
    ...over,
  }) as Invoice;

const estimate = (over: Partial<Estimate>): Estimate =>
  ({
    id: 'est-1',
    number: 'K4T9ZW-1',
    dealId: 'deal-1',
    contactId: 'contact-1',
    estimateDate: '2026-09-15',
    status: 'pending',
    name: 'Good',
    totals: { total: 50, balanceDue: 50 },
    createdAt: NOW,
    ...over,
  }) as Estimate;

describe('PortalService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let crm: ReturnType<typeof mockCrmClient>;
  let invoices: {
    listForContact: jest.Mock;
    getStored: jest.Mock;
    portalPdf: jest.Mock;
    portalHtml: jest.Mock;
    signByClient?: jest.Mock;
  };
  let estimates: {
    listForContact: jest.Mock;
    getStored: jest.Mock;
    portalPdf: jest.Mock;
    portalHtml: jest.Mock;
    approveByClient: jest.Mock;
    declineByClient: jest.Mock;
  };
  let profiles: { getPublic: jest.Mock; listAll: jest.Mock };
  let deals: { listByContact: jest.Mock };
  let service: PortalService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    process.env.PORTAL_BASE_URL = 'https://app.example.com/';
    repo = mockRepo();
    crm = mockCrmClient();
    const sentInv = invoice({ sentAt: NOW });
    const unsentInv = invoice({ id: 'deal-2', number: 'AAA111' });
    const sentEst = estimate({ sentAt: NOW });
    const unsentEst = estimate({ id: 'est-2', number: 'K4T9ZW-2', status: 'unsent' });
    invoices = {
      listForContact: jest.fn(async () => [sentInv, unsentInv]),
      getStored: jest.fn(async (id: string) => [sentInv, unsentInv].find((i) => i.id === id) ?? null),
      portalPdf: jest.fn(async () => ({ url: 'https://s3/inv.pdf' })),
      portalHtml: jest.fn(async () => ({ html: '<html>invoice</html>' })),
    };
    estimates = {
      listForContact: jest.fn(async () => [sentEst, unsentEst]),
      getStored: jest.fn(async (id: string) => [sentEst, unsentEst].find((e) => e.id === id) ?? null),
      portalPdf: jest.fn(async () => ({ url: 'https://s3/est.pdf' })),
      portalHtml: jest.fn(async () => ({ html: '<html>estimate</html>' })),
      approveByClient: jest.fn(async (id: string) => ({ ...sentEst, id, status: 'approved', items: [] })),
      declineByClient: jest.fn(async (id: string) => ({ ...sentEst, id, status: 'declined', items: [] })),
    };
    invoices.signByClient = jest.fn(async (id: string) => ({ ...sentInv, id, items: [], signatures: [{ signedBy: 'Jane' }] }));
    profiles = {
      getPublic: jest.fn(async (id?: string) => {
        if (id === 'bp-2') return { name: 'Second Brand', logoUrl: 'https://s3/logo-2' };
        const p = profile({ phone: '+18605550000' });
        return { name: p.name, phone: p.phone, logoUrl: 'https://s3/logo' };
      }),
      listAll: jest.fn(async () => [
        profile({ id: 'bp-default', name: 'Sure Lock Key', isDefault: true }),
        profile({ id: 'bp-2', name: 'Second Brand', isDefault: false }),
      ]),
    };
    deals = { listByContact: jest.fn(async () => []) };
    service = new PortalService(
      repo as never,
      crm as never,
      invoices as never,
      estimates as never,
      profiles as never,
      deals as never,
    );
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.PORTAL_BASE_URL;
    delete process.env.PORTAL_TOKEN_SECRET;
    delete process.env.INTERNAL_SERVICE_SECRET;
  });

  it('creates a link with a raw token + URL, storing only the hash', async () => {
    const link = await service.createLink('contact-1', user());
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.url).toBe(`https://app.example.com/${link.token}`);
    expect(link).toMatchObject({ contactId: 'contact-1', createdBy: 'u-1', createdAt: NOW });
    const stored = repo.links.get('contact-1')!;
    expect(stored.tokenHash).toBe(hashPortalToken(link.token!));
    expect((stored as unknown as Record<string, unknown>).token).toBeUndefined();
    expect((stored as unknown as Record<string, unknown>).url).toBeUndefined();
  });

  it('404s creating a link for an unknown contact', async () => {
    crm.getContact.mockResolvedValueOnce(null as never);
    await expect(service.createLink('nope', user())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('regenerating revokes the old token', async () => {
    const first = await service.createLink('contact-1', user());
    const second = await service.createLink('contact-1', user());
    expect(repo.saveLink).toHaveBeenLastCalledWith(expect.anything(), hashPortalToken(first.token!));
    await expect(service.publicView(first.token!)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.publicView(second.token!)).resolves.toBeDefined();
  });

  describe('link URL (recoverable tokens)', () => {
    beforeEach(() => {
      process.env.PORTAL_TOKEN_SECRET = 'test-secret';
    });

    it('re-issues the SAME url for an existing link instead of regenerating it', async () => {
      const created = await service.createLink('contact-1', user());
      const again = await service.linkUrl('contact-1', user());
      expect(again.url).toBe(created.url);
      expect(again.replaced).toBeUndefined();
      expect(repo.saveLink).toHaveBeenCalledTimes(1);
      // …and the client's link is still the live one.
      await expect(service.publicView(created.token!)).resolves.toBeDefined();
    });

    it('never stores the token or the secret, only the hash and the nonce', async () => {
      const { token } = await service.createLink('contact-1', user());
      const stored = repo.links.get('contact-1')! as unknown as Record<string, unknown>;
      expect(stored.tokenHash).toBe(hashPortalToken(token!));
      expect(typeof stored.nonce).toBe('string');
      expect(JSON.stringify(stored)).not.toContain(token!);
      expect(await service.getLink('contact-1')).not.toHaveProperty('nonce');
    });

    it('creates a link when the contact has none', async () => {
      const link = await service.linkUrl('contact-1', user());
      expect(link.url).toBe(`https://app.example.com/${link.token}`);
      expect(link.replaced).toBeUndefined();
    });

    it('replaces a link made before tokens were recoverable, and says so', async () => {
      delete process.env.PORTAL_TOKEN_SECRET;
      const legacy = await service.createLink('contact-1', user());
      process.env.PORTAL_TOKEN_SECRET = 'test-secret';
      const link = await service.linkUrl('contact-1', user());
      expect(link.replaced).toBe(true);
      expect(link.token).not.toBe(legacy.token);
      await expect(service.publicView(legacy.token!)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.publicView(link.token!)).resolves.toBeDefined();
    });

    it('replaces the link when the secret was rotated (the old token cannot be rebuilt)', async () => {
      await service.createLink('contact-1', user());
      process.env.PORTAL_TOKEN_SECRET = 'rotated';
      const link = await service.linkUrl('contact-1', user());
      expect(link.replaced).toBe(true);
    });
  });

  it('getLink hides the token and hash', async () => {
    await service.createLink('contact-1', user());
    const link = await service.getLink('contact-1');
    expect(link).toEqual({ contactId: 'contact-1', createdBy: 'u-1', createdAt: NOW });
    await expect(service.getLink('other')).resolves.toBeNull();
  });

  it('delete removes the link, 404 when there is none', async () => {
    const { token } = await service.createLink('contact-1', user());
    await service.deleteLink('contact-1');
    await expect(service.publicView(token!)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteLink('contact-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the public view lists only sent documents and records the visit', async () => {
    const { token } = await service.createLink('contact-1', user());
    const view = await service.publicView(token!);
    expect(view.preview).toBe(false);
    expect(view.client).toMatchObject({ firstName: 'Jane', lastName: 'Client' });
    expect(view.business).toMatchObject({ name: 'Sure Lock Key', logoUrl: 'https://s3/logo' });
    expect(view.invoices).toEqual([
      {
        kind: 'invoice',
        id: 'deal-1',
        number: 'K4T9ZW',
        date: '2026-09-16',
        status: 'due',
        total: 100,
        balanceDue: 100,
        dueDate: '2026-09-30',
        sent: true,
        signatureNeeded: false,
        signed: false,
        companyName: 'Sure Lock Key',
      },
    ]);
    expect(view.estimates.map((e) => e.id)).toEqual(['est-1']);
    expect(view.estimates[0]).toMatchObject({ kind: 'estimate', name: 'Good', sent: true });
    expect(repo.touchViewed).toHaveBeenCalledWith('contact-1', NOW);
  });

  it("heads the portal with the company of the most recently sent document; each summary names its company", async () => {
    deals.listByContact.mockResolvedValue([
      { id: 'deal-1', dealNumber: 'K4T9ZW', superStatus: 'submitted', businessProfileId: 'bp-2' },
      { id: 'deal-3', dealNumber: 'ZZZ999', superStatus: 'submitted' },
    ]);
    invoices.listForContact.mockResolvedValue([
      invoice({ sentAt: '2026-09-10T00:00:00.000Z' }),
      invoice({ id: 'deal-3', dealId: 'deal-3', number: 'ZZZ999', sentAt: '2026-09-12T00:00:00.000Z' }),
    ]);
    estimates.listForContact.mockResolvedValue([estimate({ sentAt: '2026-09-14T00:00:00.000Z' })]);

    const view = await service.preview('contact-1');

    // est-1 (deal-1 → bp-2) was sent last.
    expect(profiles.getPublic).toHaveBeenCalledWith('bp-2');
    expect(view.business).toEqual({ name: 'Second Brand', logoUrl: 'https://s3/logo-2' });
    expect(view.invoices.map((i) => [i.id, i.companyName])).toEqual([
      ['deal-1', 'Second Brand'],
      ['deal-3', 'Sure Lock Key'],
    ]);
    expect(view.estimates[0].companyName).toBe('Second Brand');
  });

  it('falls back to the default company when nothing was sent or deal-service is down', async () => {
    deals.listByContact.mockRejectedValue(new Error('down'));
    invoices.listForContact.mockResolvedValue([invoice({})]);
    estimates.listForContact.mockResolvedValue([]);
    const view = await service.preview('contact-1');
    expect(profiles.getPublic).toHaveBeenCalledWith(undefined);
    expect(view.business.name).toBe('Sure Lock Key');
    expect(view.invoices[0].companyName).toBe('Sure Lock Key');
  });

  it('rejects malformed and unknown tokens with 404', async () => {
    await expect(service.publicView('short')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.publicView('A'.repeat(43))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the preview includes unsent documents', async () => {
    const view = await service.preview('contact-1');
    expect(view.preview).toBe(true);
    expect(view.invoices).toHaveLength(2);
    expect(view.estimates).toHaveLength(2);
    expect(view.invoices[1].sent).toBe(false);
    expect(repo.touchViewed).not.toHaveBeenCalled();
  });

  describe('public html', () => {
    it('serves the on-screen document under the same rules as the pdf', async () => {
      const { token } = await service.createLink('contact-1', user());
      await expect(service.publicHtml(token!, 'invoice', 'deal-1')).resolves.toEqual({ html: '<html>invoice</html>' });
      await expect(service.publicHtml(token!, 'estimate', 'est-1')).resolves.toEqual({ html: '<html>estimate</html>' });
      await expect(service.publicHtml(token!, 'invoice', 'deal-2')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.publicHtml(token!, 'receipt', 'x')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.publicHtml('A'.repeat(43), 'invoice', 'deal-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('the Workiz-style portal view', () => {
    it('carries the company tagline + booking link, the client’s contact details, the invoice signature state', async () => {
      profiles.getPublic.mockResolvedValueOnce({
        name: 'Sure Lock Key',
        phone: '+12037479615',
        description: 'Offering Locksmith, Door, and Garage Door Services!',
        bookingUrl: 'https://book.example.com',
        logoUrl: 'https://s3/logo',
      });
      invoices.listForContact.mockResolvedValueOnce([
        invoice({ sentAt: NOW, requestSignature: true }),
        invoice({ id: 'deal-3', number: 'B3', sentAt: NOW, requestSignature: true, signedAt: NOW }),
        invoice({ id: 'deal-4', number: 'B4', sentAt: NOW }),
      ]);
      const { token } = await service.createLink('contact-1', user());
      const view = await service.publicView(token!);
      expect(view.business).toMatchObject({ description: 'Offering Locksmith, Door, and Garage Door Services!', bookingUrl: 'https://book.example.com' });
      expect(view.client).toEqual({ firstName: 'Jane', lastName: 'Client', email: 'jane@example.com', phone: '+18605550100' });
      const byId = Object.fromEntries(view.invoices.map((i) => [i.id, i]));
      expect(byId['deal-1']).toMatchObject({ signatureNeeded: true, signed: false });
      expect(byId['deal-3']).toMatchObject({ signatureNeeded: false, signed: true });
      expect(byId['deal-4']).toMatchObject({ signatureNeeded: false, signed: false });
    });

    it('My Booking: the client’s upcoming (submitted, future) and completed (done) jobs, nothing else', async () => {
      deals.listByContact.mockResolvedValue([
        { id: 'j1', dealNumber: 'J1', superStatus: 'submitted', scheduledDate: '2026-09-20T14:00:00.000Z', scheduledEndDate: '2026-09-20T16:00:00.000Z', jobTypeName: 'Lock change', technicianNames: ['Mike Smith'], address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' } },
        { id: 'j2', dealNumber: 'J2', superStatus: 'done', scheduledDate: '2026-09-01T14:00:00.000Z', jobTypeName: 'Rekey' },
        { id: 'j3', dealNumber: 'J3', superStatus: 'in_progress', scheduledDate: '2026-09-16T09:00:00.000Z' },
        { id: 'j4', dealNumber: 'J4', superStatus: 'canceled', scheduledDate: '2026-09-25T09:00:00.000Z' },
        { id: 'j5', dealNumber: 'J5', superStatus: 'submitted', scheduledDate: '2026-09-10T09:00:00.000Z' },
      ]);
      const { token } = await service.createLink('contact-1', user());
      const view = await service.publicView(token!);
      expect(view.jobs.map((j) => [j.id, j.kind])).toEqual([
        ['j1', 'upcoming'],
        ['j2', 'completed'],
      ]);
      expect(view.jobs[0]).toMatchObject({
        number: 'J1',
        scheduledDate: '2026-09-20T14:00:00.000Z',
        scheduledEndDate: '2026-09-20T16:00:00.000Z',
        jobType: 'Lock change',
        technicians: ['Mike Smith'],
        address: '1 Main St, Hartford, CT 06103',
      });
    });

    it('Payment history: the client’s settled, refunded and clearing payments, newest first, never a card number', async () => {
      const ledger = {
        listByInvoice: jest.fn(async () => []),
        list: jest.fn(async () => ({
          items: [
            { id: 'p1', invoiceId: 'deal-1', dealId: 'deal-1', amount: 50.46, method: 'card', status: 'settled', refundedAmount: 0, takenAt: '2026-09-29T13:52:00.000Z', createdAt: '2026-09-29T13:52:00.000Z', cardBrand: 'visa', last4: '4061', stripePaymentIntentId: 'pi_secret' },
            { id: 'p2', invoiceId: 'deal-1', dealId: 'deal-1', estimateId: 'est-1', amount: 100, method: 'bank', status: 'pending', refundedAmount: 0, takenAt: '2026-09-30T10:00:00.000Z', createdAt: '2026-09-30T10:00:00.000Z' },
            { id: 'p3', invoiceId: 'deal-1', dealId: 'deal-1', amount: 20, method: 'card', status: 'failed', refundedAmount: 0, takenAt: '2026-09-28T10:00:00.000Z', createdAt: '2026-09-28T10:00:00.000Z' },
          ],
        })),
      };
      const paymentSettings = { get: jest.fn(async () => ({})), methodsFor: jest.fn(() => []) };
      const withLedger = new PortalService(repo as never, crm as never, invoices as never, estimates as never, profiles as never, deals as never, ledger as never, paymentSettings as never, undefined);
      const { token } = await withLedger.createLink('contact-1', user());
      const view = await withLedger.publicView(token!);
      expect(ledger.list).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'contact-1' }));
      expect(view.payments.map((p) => p.id)).toEqual(['p2', 'p1']);
      expect(view.payments[1]).toEqual({
        id: 'p1',
        amount: 50.46,
        method: 'card',
        status: 'settled',
        takenAt: '2026-09-29T13:52:00.000Z',
        invoiceId: 'deal-1',
        cardBrand: 'visa',
        last4: '4061',
      });
      expect(view.payments[0]).toMatchObject({ estimateId: 'est-1', status: 'pending' });
    });
  });

  describe('client decisions (approve / decline / sign)', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';

    it('approves the token’s own SENT estimate through the estimate service, passing the client IP', async () => {
      const { token } = await service.createLink('contact-1', user());
      const out = await service.approveEstimate(token!, 'est-1', { imageDataUrl: PNG, signedBy: 'Jane', ip: '1.1.1.1' });
      expect(estimates.approveByClient).toHaveBeenCalledWith('est-1', { imageDataUrl: PNG, signedBy: 'Jane', ip: '1.1.1.1' });
      expect(out.status).toBe('approved');
    });

    it('declines with a reason', async () => {
      const { token } = await service.createLink('contact-1', user());
      const out = await service.declineEstimate(token!, 'est-1', { reason: 'Too much' });
      expect(estimates.declineByClient).toHaveBeenCalledWith('est-1', { reason: 'Too much' });
      expect(out.status).toBe('declined');
    });

    it('signs the token’s own SENT invoice', async () => {
      const { token } = await service.createLink('contact-1', user());
      const out = await service.signInvoice(token!, 'deal-1', { imageDataUrl: PNG, signedBy: 'Jane' });
      expect(invoices.signByClient).toHaveBeenCalledWith('deal-1', { imageDataUrl: PNG, signedBy: 'Jane' });
      expect(out.signatures).toHaveLength(1);
    });

    it('404s an unsent estimate, another contact’s document, or a bad token — nothing is written', async () => {
      const { token } = await service.createLink('contact-1', user());
      await expect(service.approveEstimate(token!, 'est-2', { imageDataUrl: PNG, signedBy: 'J' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.declineEstimate(token!, 'est-2', {})).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.signInvoice(token!, 'deal-2', { imageDataUrl: PNG, signedBy: 'J' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.approveEstimate('nope', 'est-1', { imageDataUrl: PNG, signedBy: 'J' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(estimates.approveByClient).not.toHaveBeenCalled();
      expect(estimates.declineByClient).not.toHaveBeenCalled();
      expect(invoices.signByClient).not.toHaveBeenCalled();
    });

    it('with the ledger wired, an approved estimate with a deposit still owed is payable, and the paid part is shown', async () => {
      estimates.listForContact.mockResolvedValueOnce([
        estimate({ sentAt: NOW, status: 'approved', approvedVia: 'portal', depositPercentage: 50, totals: { total: 200, balanceDue: 200 } as never }),
      ]);
      const ledger = {
        listByInvoice: jest.fn(async () => [
          { id: 'p1', estimateId: 'est-1', amount: 40, status: 'settled', refundedAmount: 0 },
          { id: 'p2', amount: 10, status: 'settled', refundedAmount: 0 },
        ]),
      };
      const paymentSettings = {
        get: jest.fn(async () => ({ onlinePaymentsEnabled: true, cardEnabled: true, bankEnabled: false })),
        methodsFor: jest.fn(() => ['card']),
      };
      const withLedger = new PortalService(
        repo as never,
        crm as never,
        invoices as never,
        estimates as never,
        profiles as never,
        deals as never,
        ledger as never,
        paymentSettings as never,
        { onlineReady: true } as never,
      );
      const { token } = await withLedger.createLink('contact-1', user());
      const view = await withLedger.publicView(token!);
      expect(view.estimates[0]).toMatchObject({ depositDue: 100, depositPaid: 40, payable: true, signed: true });
    });

    it('the inbox says which estimates still need a signature and what deposit is due', async () => {
      estimates.listForContact.mockResolvedValueOnce([
        estimate({ sentAt: NOW, depositPercentage: 50, totals: { total: 200, balanceDue: 200 } as never }),
        estimate({ id: 'est-3', number: 'K4T9ZW-3', sentAt: NOW, status: 'approved', depositAmount: 30 }),
      ]);
      const { token } = await service.createLink('contact-1', user());
      const view = await service.publicView(token!);
      const open = view.estimates.find((e) => e.id === 'est-1')!;
      const done = view.estimates.find((e) => e.id === 'est-3')!;
      expect(open).toMatchObject({ signatureNeeded: true, depositDue: 100 });
      expect(done).toMatchObject({ signatureNeeded: false, depositDue: 30 });
    });
  });

  describe('public pdf', () => {
    let token: string;
    beforeEach(async () => {
      token = (await service.createLink('contact-1', user())).token!;
    });

    it('serves a sent document of this contact', async () => {
      await expect(service.publicPdf(token, 'invoice', 'deal-1')).resolves.toEqual({ url: 'https://s3/inv.pdf' });
      await expect(service.publicPdf(token, 'estimate', 'est-1')).resolves.toEqual({ url: 'https://s3/est.pdf' });
      // Inline by default so the portal can embed the PDF; attachment only on request.
      expect(invoices.portalPdf).toHaveBeenCalledWith('deal-1', false);
      await service.publicPdf(token, 'estimate', 'est-1', true);
      expect(estimates.portalPdf).toHaveBeenLastCalledWith('est-1', true);
    });

    it('404s for another contact’s document, an unsent one, or an unknown kind', async () => {
      invoices.getStored.mockResolvedValueOnce(invoice({ contactId: 'someone-else', sentAt: NOW }));
      await expect(service.publicPdf(token, 'invoice', 'deal-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.publicPdf(token, 'invoice', 'deal-2')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.publicPdf(token, 'estimate', 'est-2')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.publicPdf(token, 'receipt', 'x')).rejects.toBeInstanceOf(NotFoundException);
      expect(invoices.portalPdf).not.toHaveBeenCalled();
    });
  });
});

describe('LegacyPortalRedirectController', () => {
  beforeEach(() => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.com';
  });
  afterEach(() => {
    delete process.env.PORTAL_BASE_URL;
  });

  it('sends an old <api>/portal/<token> link on to the portal domain', () => {
    const token = 'A'.repeat(43);
    expect(new LegacyPortalRedirectController().redirect(token)).toEqual({ url: `https://portal.example.com/${token}` });
  });

  it('404s something that cannot be a token', () => {
    expect(() => new LegacyPortalRedirectController().redirect('nope')).toThrow(NotFoundException);
  });
});

describe('PortalRateLimiter', () => {
  function fakeRedis() {
    const counts = new Map<string, number>();
    return {
      counts,
      client: {
        incr: jest.fn(async (k: string) => {
          counts.set(k, (counts.get(k) ?? 0) + 1);
          return counts.get(k)!;
        }),
        expire: jest.fn(async () => 1),
      },
    };
  }

  it('allows up to the limit per ip+token per minute, then 429s', async () => {
    const redis = fakeRedis();
    const limiter = new PortalRateLimiter(redis as never, 3);
    for (let i = 0; i < 3; i++) await limiter.check('1.2.3.4', 'tok');
    await expect(limiter.check('1.2.3.4', 'tok')).rejects.toBeInstanceOf(HttpException);
    await expect(limiter.check('1.2.3.4', 'other')).resolves.toBeUndefined();
    expect(redis.client.expire).toHaveBeenCalledWith(expect.any(String), 60);
    // the raw token never appears in a Redis key
    expect([...redis.counts.keys()].some((k) => k.includes('tok'))).toBe(false);
  });

  it('fails open when Redis is unavailable', async () => {
    const limiter = new PortalRateLimiter(
      { client: { incr: jest.fn().mockRejectedValue(new Error('down')), expire: jest.fn() } } as never,
      1,
    );
    await expect(limiter.check('ip', 'tok')).resolves.toBeUndefined();
  });
});

import { NotFoundException, HttpException } from '@nestjs/common';
import type { Estimate, Invoice } from '@bitcrm/types';
import { PortalService } from 'src/portal/portal.service';
import { PortalRateLimiter } from 'src/portal/portal-rate-limiter';
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
  let invoices: { listForContact: jest.Mock; getStored: jest.Mock; portalPdf: jest.Mock };
  let estimates: { listForContact: jest.Mock; getStored: jest.Mock; portalPdf: jest.Mock };
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
    };
    estimates = {
      listForContact: jest.fn(async () => [sentEst, unsentEst]),
      getStored: jest.fn(async (id: string) => [sentEst, unsentEst].find((e) => e.id === id) ?? null),
      portalPdf: jest.fn(async () => ({ url: 'https://s3/est.pdf' })),
    };
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
  });

  it('creates a link with a raw token + URL, storing only the hash', async () => {
    const link = await service.createLink('contact-1', user());
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.url).toBe(`https://app.example.com/portal/${link.token}`);
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
    expect(view.client).toEqual({ firstName: 'Jane', lastName: 'Client' });
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

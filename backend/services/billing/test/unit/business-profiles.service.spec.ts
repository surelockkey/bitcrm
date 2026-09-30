import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DEFAULT_BUSINESS_PROFILE,
  DEFAULT_BUSINESS_PROFILE_ID,
  PaymentTerms,
  type BusinessProfile,
} from '@bitcrm/types';
import { BusinessProfileService } from 'src/business-profile/business-profile.service';
import { NOW } from './mocks';

function mockRepo(initial: BusinessProfile[] = [], legacy: Partial<BusinessProfile> | null = null) {
  const store = new Map(initial.map((p) => [p.id, { ...p }]));
  const state = { legacy: legacy as Record<string, unknown> | null };
  return {
    store,
    state,
    list: jest.fn(async () => [...store.values()].map((p) => ({ ...p }))),
    get: jest.fn(async (id: string) => (store.has(id) ? { ...store.get(id)! } : null)),
    create: jest.fn(async (p: BusinessProfile) => {
      if (store.has(p.id)) throw new Error('exists');
      store.set(p.id, { ...p });
    }),
    put: jest.fn(async (p: BusinessProfile) => void store.set(p.id, { ...p })),
    delete: jest.fn(async (id: string) => void store.delete(id)),
    setDefault: jest.fn(async (id: string, others: string[]) => {
      store.get(id)!.isDefault = true;
      for (const o of others) if (store.has(o)) store.get(o)!.isDefault = false;
    }),
    getLegacy: jest.fn(async () => (state.legacy ? { ...state.legacy } : null)),
    migrateLegacy: jest.fn(async (p: BusinessProfile) => {
      if (store.has(p.id)) return false;
      store.set(p.id, { ...p });
      state.legacy = null;
      return true;
    }),
  };
}

const company = (over: Partial<BusinessProfile>): BusinessProfile => ({
  ...DEFAULT_BUSINESS_PROFILE,
  id: 'bp-x',
  name: 'X',
  isDefault: false,
  active: true,
  createdAt: NOW,
  ...over,
});

describe('BusinessProfileService (many companies)', () => {
  let repo: ReturnType<typeof mockRepo>;
  let assets: { get: jest.Mock };
  let s3: { objectExists: jest.Mock; getPresignedDownloadUrl: jest.Mock };
  let templates: { list: jest.Mock };
  let service: BusinessProfileService;

  const build = (r: ReturnType<typeof mockRepo>) => {
    repo = r;
    service = new BusinessProfileService(repo as never, assets as never, templates as never, s3 as never);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    assets = { get: jest.fn(async (id: string) => ({ id, contentType: 'image/png' })) };
    s3 = {
      objectExists: jest.fn(async () => true),
      getPresignedDownloadUrl: jest.fn(async (key: string) => `https://s3/${key}`),
    };
    templates = { list: jest.fn(async () => []) };
    build(mockRepo());
  });
  afterEach(() => jest.useRealTimers());

  describe('lazy migration of the legacy singleton', () => {
    it('moves SETTINGS/BUSINESS_PROFILE into bp-default (default, active) on first list', async () => {
      build(mockRepo([], { name: 'Legacy Locks', phone: '+1860', defaultPaymentTerms: PaymentTerms.NET_15, dueDateBasis: 'job_created' }));

      const list = await service.list();

      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: DEFAULT_BUSINESS_PROFILE_ID,
        name: 'Legacy Locks',
        phone: '+1860',
        isDefault: true,
        active: true,
        defaultPaymentTerms: PaymentTerms.NET_15,
        dueDateBasis: 'job_created',
      });
      expect(repo.migrateLegacy).toHaveBeenCalledTimes(1);
    });

    it('is idempotent (a lost race or a second call changes nothing)', async () => {
      build(mockRepo([], { name: 'Legacy' }));
      await service.list();
      await service.list();
      expect(repo.migrateLegacy).toHaveBeenCalledTimes(1);

      // Another instance already migrated: migrateLegacy reports false, nothing breaks.
      const r = mockRepo([company({ id: DEFAULT_BUSINESS_PROFILE_ID, isDefault: true, name: 'Done' })], { name: 'Legacy' });
      build(r);
      expect((await service.list()).map((p) => p.name)).toEqual(['Done']);
    });

    it('does not make the migrated row default when another default already exists', async () => {
      build(mockRepo([company({ id: 'bp-1', name: 'Existing', isDefault: true })], { name: 'Legacy' }));
      const list = await service.list();
      expect(list.find((p) => p.id === DEFAULT_BUSINESS_PROFILE_ID)?.isDefault).toBe(false);
      expect(list.filter((p) => p.isDefault)).toHaveLength(1);
    });

    it('with no legacy row and no companies, lists nothing but documents still get a virtual default', async () => {
      expect(await service.list()).toEqual([]);
      expect(await service.get()).toMatchObject({ id: DEFAULT_BUSINESS_PROFILE_ID, name: DEFAULT_BUSINESS_PROFILE.name });
    });
  });

  describe('list / get', () => {
    beforeEach(() =>
      build(
        mockRepo([
          company({ id: 'b', name: 'Beta' }),
          company({ id: 'z', name: 'Zeta', isDefault: true, logoAssetId: 'logo-1' }),
          company({ id: 'a', name: 'Alpha' }),
          company({ id: 'old', name: 'Archived', active: false }),
        ]),
      ),
    );

    it('sorts default first, then by name; hides archived unless asked; resolves logo URLs', async () => {
      const list = await service.list();
      expect(list.map((p) => p.id)).toEqual(['z', 'a', 'b']);
      expect(list[0].logoUrl).toBe('https://s3/billing/assets/logo-1');
      expect((await service.list({ includeInactive: true })).map((p) => p.id)).toEqual(['z', 'a', 'old', 'b']);
    });

    it('listAll (internal) includes archived companies, without logo URLs', async () => {
      const all = await service.listAll();
      expect(all).toHaveLength(4);
      expect(all[0]).not.toHaveProperty('logoUrl');
    });

    it('getView 404s for an unknown id', async () => {
      expect((await service.getView('a')).name).toBe('Alpha');
      await expect(service.getView('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it("get(id) returns that company (even archived), else the default", async () => {
      expect((await service.get('old')).name).toBe('Archived');
      expect((await service.get('gone')).id).toBe('z');
      expect((await service.get()).id).toBe('z');
      expect((await service.get(undefined)).id).toBe('z');
    });

    it('getPublic(id) exposes only the public fields of that company', async () => {
      const pub = await service.getPublic('z');
      expect(pub).toEqual({
        name: 'Zeta',
        phone: undefined,
        email: undefined,
        website: undefined,
        address: undefined,
        logoUrl: 'https://s3/billing/assets/logo-1',
      });
    });
  });

  describe('create', () => {
    it('makes the first company the default', async () => {
      const created = await service.create({ name: 'First' } as never, 'u-1');
      expect(created).toMatchObject({
        name: 'First',
        isDefault: true,
        active: true,
        defaultPaymentTerms: PaymentTerms.CASH,
        dueDateBasis: 'invoice_created',
        createdBy: 'u-1',
        createdAt: NOW,
      });
      expect(created.id).toMatch(/^bp-/);
      const second = await service.create({ name: 'Second', phone: '+1' } as never, 'u-1');
      expect(second.isDefault).toBe(false);
      expect(repo.store.size).toBe(2);
    });

    it('rejects a blank name', async () => {
      await expect(service.create({ name: '  ' } as never, 'u')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('verifies the logo was actually uploaded (422 otherwise)', async () => {
      s3.objectExists.mockResolvedValueOnce(false);
      await expect(service.create({ name: 'A', logoAssetId: 'logo-9' } as never, 'u')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(s3.objectExists).toHaveBeenCalledWith('billing/assets/logo-9');
      assets.get.mockResolvedValueOnce(null);
      await expect(service.create({ name: 'A', logoAssetId: 'nope' } as never, 'u')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    beforeEach(() =>
      build(
        mockRepo([
          company({ id: 'd', name: 'Default', isDefault: true }),
          company({
            id: 'o',
            name: 'Other',
            phone: '+1',
            email: 'o@x.com',
            logoAssetId: 'logo-1',
            address: { street: '1 Main', city: 'Hartford', state: 'CT', zip: '06103' },
          }),
        ]),
      ),
    );

    it('is partial, and null clears optional fields (logo included)', async () => {
      const out = await service.update('o', { website: 'https://o.com', phone: null, logoAssetId: null, address: null } as never, 'u-2');
      expect(out).toMatchObject({ name: 'Other', email: 'o@x.com', website: 'https://o.com', updatedBy: 'u-2' });
      expect(out).not.toHaveProperty('phone');
      expect(out).not.toHaveProperty('logoAssetId');
      expect(out).not.toHaveProperty('address');
      expect(repo.store.get('o')).not.toHaveProperty('phone');
    });

    it('keeps lat/lng on the address', async () => {
      const out = await service.update(
        'o',
        { address: { street: '2 Elm', city: 'Hartford', state: 'CT', zip: '06103', lat: 41.76, lng: -72.68 } } as never,
        'u',
      );
      expect(out.address).toMatchObject({ lat: 41.76, lng: -72.68 });
    });

    it('never clears the name, isDefault or id', async () => {
      await expect(service.update('o', { name: null } as never, 'u')).rejects.toBeInstanceOf(BadRequestException);
      const out = await service.update('o', { isDefault: true, id: 'hack' } as never, 'u');
      expect(out).toMatchObject({ id: 'o', isDefault: false });
    });

    it('checks a NEW logo only', async () => {
      await service.update('o', { logoAssetId: 'logo-1', name: 'Renamed' } as never, 'u');
      expect(s3.objectExists).not.toHaveBeenCalled();
      s3.objectExists.mockResolvedValueOnce(false);
      await expect(service.update('o', { logoAssetId: 'logo-2' } as never, 'u')).rejects.toThrow('Logo upload did not finish');
    });

    it('refuses to archive the default company', async () => {
      await expect(service.update('d', { active: false } as never, 'u')).rejects.toBeInstanceOf(BadRequestException);
      expect((await service.update('o', { active: false } as never, 'u')).active).toBe(false);
    });

    it('404s for an unknown company', async () => {
      await expect(service.update('nope', { name: 'x' } as never, 'u')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setDefault', () => {
    beforeEach(() =>
      build(
        mockRepo([
          company({ id: 'd', name: 'Default', isDefault: true }),
          company({ id: 'o', name: 'Other' }),
          company({ id: 'arch', name: 'Archived', active: false }),
        ]),
      ),
    );

    it('makes it the single default (others cleared in one call)', async () => {
      const out = await service.setDefault('o');
      expect(out.isDefault).toBe(true);
      expect(repo.setDefault).toHaveBeenCalledWith('o', ['d'], NOW);
      expect([...repo.store.values()].filter((p) => p.isDefault).map((p) => p.id)).toEqual(['o']);
    });

    it('rejects an archived or unknown company', async () => {
      await expect(service.setDefault('arch')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setDefault('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    beforeEach(() =>
      build(
        mockRepo([company({ id: 'd', name: 'Default', isDefault: true }), company({ id: 'o', name: 'Other' })]),
      ),
    );

    it('deletes a non-default company', async () => {
      await service.remove('o');
      expect(repo.delete).toHaveBeenCalledWith('o');
    });

    it('409s for the default company', async () => {
      await expect(service.remove('d')).rejects.toBeInstanceOf(ConflictException);
    });

    it('409s while a template auto-applies to it', async () => {
      templates.list.mockResolvedValueOnce([
        { id: 't1', name: 'Brand invoice', autoApply: { businessProfileIds: ['o'] } },
      ]);
      await expect(service.remove('o')).rejects.toThrow(/Brand invoice/);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('404s for an unknown company', async () => {
      await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('compat singleton (GET/PUT /business-profile)', () => {
    it('reads the default company view', async () => {
      build(mockRepo([company({ id: 'd', name: 'Default', isDefault: true, logoAssetId: 'l' })]));
      expect(await service.getWithLogo()).toMatchObject({ id: 'd', name: 'Default', logoUrl: 'https://s3/billing/assets/l' });
    });

    it('writes to the default company', async () => {
      build(mockRepo([company({ id: 'd', name: 'Default', isDefault: true })]));
      const out = await service.updateDefault(
        { name: 'Renamed', defaultPaymentTerms: PaymentTerms.NET_30, dueDateBasis: 'invoice_created' } as never,
        'u',
      );
      expect(out).toMatchObject({ id: 'd', name: 'Renamed', defaultPaymentTerms: PaymentTerms.NET_30 });
    });

    it('creates bp-default when there is no company yet', async () => {
      const out = await service.updateDefault(
        { name: 'Brand new', defaultPaymentTerms: PaymentTerms.CASH, dueDateBasis: 'invoice_created' } as never,
        'u',
      );
      expect(out).toMatchObject({ id: DEFAULT_BUSINESS_PROFILE_ID, name: 'Brand new', isDefault: true, active: true });
      expect(repo.store.has(DEFAULT_BUSINESS_PROFILE_ID)).toBe(true);
    });
  });
});

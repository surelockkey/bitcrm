import axios from 'axios';
import { BadRequestException } from '@nestjs/common';
import { BusinessProfilesClient } from 'src/common/services/business-profiles.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const profile = (over: Record<string, unknown>) => ({
  id: 'bp-default',
  name: 'Acme Locks',
  isDefault: true,
  active: true,
  defaultPaymentTerms: 'cash',
  dueDateBasis: 'invoice_created',
  ...over,
});

describe('BusinessProfilesClient', () => {
  let get: jest.Mock;
  let createConfig: any;
  let client: BusinessProfilesClient;
  let now: number;

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      data: {
        success: true,
        data: [
          profile({}),
          profile({ id: 'bp-2', name: 'Second Brand', isDefault: false }),
          profile({ id: 'bp-old', name: 'Old Brand', isDefault: false, active: false }),
        ],
      },
    });
    mockedAxios.create.mockImplementation((config: any) => {
      createConfig = config;
      return { get } as any;
    });
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    client = new BusinessProfilesClient();
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads the billing internal list with the internal secret header', async () => {
    const list = await client.list();
    expect(list).toHaveLength(3);
    expect(get).toHaveBeenCalledWith('/api/billing/business-profiles/internal');
    expect(createConfig.baseURL).toContain('4008');
    expect(createConfig.headers).toHaveProperty('x-internal-secret');
  });

  it('caches the list for 60 seconds', async () => {
    await client.list();
    now += 59_000;
    await client.list();
    expect(get).toHaveBeenCalledTimes(1);
    now += 2_000;
    await client.list();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('returns null (and does not cache) when billing is unreachable', async () => {
    get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await client.list()).toBeNull();
    expect(await client.list()).toHaveLength(3);
  });

  it('finds the active default company', async () => {
    expect((await client.findDefault())?.id).toBe('bp-default');
    get.mockRejectedValueOnce(new Error('down'));
    client.clearCache();
    expect(await client.findDefault()).toBeNull();
  });

  describe('resolve', () => {
    it('returns id + name for an active company', async () => {
      expect(await client.resolve('bp-2')).toEqual({ id: 'bp-2', name: 'Second Brand' });
    });

    it('rejects an unknown or archived company', async () => {
      await expect(client.resolve('nope')).rejects.toThrow(BadRequestException);
      await expect(client.resolve('bp-old')).rejects.toThrow(BadRequestException);
    });

    it('accepts an archived company when allowed (keeping an existing value)', async () => {
      expect(await client.resolve('bp-old', { allowInactive: true })).toEqual({ id: 'bp-old', name: 'Old Brand' });
    });

    it('accepts the id without a name when billing is down', async () => {
      get.mockRejectedValueOnce(new Error('down'));
      expect(await client.resolve('whatever')).toEqual({ id: 'whatever' });
    });

    it('re-fetches once on a cache miss before rejecting (company created seconds ago)', async () => {
      await client.list();
      get.mockResolvedValueOnce({ data: { data: [profile({ id: 'bp-new', name: 'New', isDefault: false })] } });
      expect(await client.resolve('bp-new')).toEqual({ id: 'bp-new', name: 'New' });
      expect(get).toHaveBeenCalledTimes(2);
    });
  });
});

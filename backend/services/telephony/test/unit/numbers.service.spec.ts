import { HttpException } from '@nestjs/common';
import { TwilioRest } from '@bitcrm/shared';
import {
  NumbersService,
  OWNED_NUMBERS_PAGE_SIZE,
} from '../../src/numbers/numbers.service';
import { type TelephonyConfig } from '../../src/telephony/telephony.config';

/**
 * A workspace migrating from Workiz brings ~274 numbers. Twilio pages the
 * list, and the old `list({ limit: 100 })` stopped at the first page — so
 * these specs drive the service with a fake client that really pages.
 */

type FakeNumber = {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl?: string | null;
  smsUrl?: string | null;
  capabilities?: { sms?: boolean; mms?: boolean; voice?: boolean; fax?: boolean };
};

const fakeNumber = (i: number, over: Partial<FakeNumber> = {}): FakeNumber => ({
  sid: `PN${String(i).padStart(4, '0')}`,
  phoneNumber: `+1555${String(i).padStart(7, '0')}`,
  friendlyName: `Line ${i}`,
  voiceUrl: 'https://api.example.test/api/telephony/voice/inbound',
  smsUrl: '',
  capabilities: { sms: true, mms: i % 2 === 0, voice: true, fax: false },
  ...over,
});

/** Chain `numbers` into SDK-shaped pages of `pageSize`, last one with no next. */
function pagesOf(numbers: FakeNumber[], pageSize: number) {
  const pages: Array<{ instances: FakeNumber[]; nextPage: jest.Mock }> = [];
  for (let i = 0; i < numbers.length; i += pageSize) {
    pages.push({ instances: numbers.slice(i, i + pageSize), nextPage: jest.fn() });
  }
  if (pages.length === 0) pages.push({ instances: [], nextPage: jest.fn() });
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    p.nextPage.mockImplementation(() => (next ? Promise.resolve(next) : undefined));
  });
  return pages;
}

function makeService(
  over: {
    numbers?: FakeNumber[];
    /** MG sid → members, as the Messaging API reports them. */
    services?: Record<string, string[]>;
    messagingServiceSid?: string;
    pageError?: unknown;
    membershipError?: unknown;
  } = {},
) {
  const numbers = over.numbers ?? [fakeNumber(1)];
  const pages = pagesOf(numbers, OWNED_NUMBERS_PAGE_SIZE);
  const page = jest.fn(async (_params: { pageSize?: number; limit?: number }) => {
    if (over.pageError) throw over.pageError;
    return pages[0];
  });
  const services = over.services ?? {};
  const servicesList = jest.fn(async () => {
    if (over.membershipError) throw over.membershipError;
    return Object.keys(services).map((sid) => ({ sid }));
  });
  const membersList = jest.fn(async (sid: string) => {
    if (over.membershipError) throw over.membershipError;
    return (services[sid] ?? []).map((phoneNumber) => ({ phoneNumber }));
  });
  const client = {
    incomingPhoneNumbers: { page, list: jest.fn() },
    messaging: {
      v1: {
        services: Object.assign(
          (sid: string) => ({ phoneNumbers: { list: () => membersList(sid) } }),
          { list: servicesList },
        ),
      },
    },
  };

  const config = {
    accountSid: 'AC00000000000000000000000000000000',
    authToken: 'the-auth-token',
    publicBaseUrl: 'https://api.example.test',
    messagingServiceSid: over.messagingServiceSid,
  } as TelephonyConfig;
  const service = new NumbersService(config);
  // The real runner (error translation included) over the fake client.
  (service as any).rest = new TwilioRest(config, () => client as never);

  return { service, page, pages, servicesList, membersList };
}

describe('NumbersService.listOwned', () => {
  it('walks every page — 274 numbers across three pages, in order', async () => {
    const all = Array.from({ length: 274 }, (_, i) => fakeNumber(i + 1));
    const { service, page, pages } = makeService({ numbers: all });

    const owned = await service.listOwned();

    expect(owned).toHaveLength(274);
    expect(owned[0].phoneNumber).toBe(all[0].phoneNumber);
    expect(owned[273].phoneNumber).toBe(all[273].phoneNumber);
    expect(pages).toHaveLength(3);
    expect(page).toHaveBeenCalledTimes(1);
    expect(pages[0].nextPage).toHaveBeenCalledTimes(1);
    expect(pages[1].nextPage).toHaveBeenCalledTimes(1);
    expect(pages[2].nextPage).toHaveBeenCalledTimes(1);
  });

  it('asks for pages, not a capped list', async () => {
    const { service, page } = makeService();
    await service.listOwned();
    expect(page).toHaveBeenCalledWith({ pageSize: OWNED_NUMBERS_PAGE_SIZE });
    expect(page.mock.calls[0][0]).not.toHaveProperty('limit');
  });

  it('keeps the shape the dialer, caller-id resolver and lines health read', async () => {
    const { service } = makeService({ numbers: [fakeNumber(7)] });
    const [n] = await service.listOwned();
    expect(n).toEqual({
      sid: 'PN0007',
      phoneNumber: '+15550000007',
      friendlyName: 'Line 7',
      voiceUrl: 'https://api.example.test/api/telephony/voice/inbound',
    });
  });

  it('returns an empty list for an account with no numbers', async () => {
    const { service } = makeService({ numbers: [] });
    await expect(service.listOwned()).resolves.toEqual([]);
  });

  it('surfaces the Twilio status instead of a generic 500', async () => {
    const { service } = makeService({
      pageError: Object.assign(new Error('Authenticate'), { status: 401 }),
    });
    const failure = service.listOwned();
    await expect(failure).rejects.toBeInstanceOf(HttpException);
    await failure.catch((e: HttpException) => {
      expect(e.getStatus()).toBe(401);
      expect(e.message).toBe('Authenticate');
    });
  });
});

describe('NumbersService.listOwnedDetailed', () => {
  it('adds the capabilities as plain booleans', async () => {
    const { service } = makeService({
      numbers: [
        fakeNumber(1, { capabilities: { sms: true, mms: false, voice: true, fax: false } }),
        fakeNumber(2, { capabilities: undefined }),
      ],
    });

    const [withCaps, without] = await service.listOwnedDetailed();

    expect(withCaps.capabilities).toEqual({ sms: true, mms: false, voice: true });
    expect(without.capabilities).toEqual({ sms: false, mms: false, voice: false });
    expect(withCaps).toMatchObject({ sid: 'PN0001', phoneNumber: '+15550000001' });
  });

  it('pages exactly like listOwned', async () => {
    const all = Array.from({ length: 150 }, (_, i) => fakeNumber(i + 1));
    const { service } = makeService({ numbers: all });
    await expect(service.listOwnedDetailed()).resolves.toHaveLength(150);
  });
});

describe('NumbersService.messagingServiceMembership', () => {
  it('reads only the configured Messaging Service when there is one', async () => {
    const { service, servicesList, membersList } = makeService({
      messagingServiceSid: 'MGconfigured',
      services: {
        MGconfigured: ['+15550000001', '+15550000002'],
        MGother: ['+15550000003'],
      },
    });

    const membership = await service.messagingServiceMembership();

    expect(servicesList).not.toHaveBeenCalled();
    expect(membersList).toHaveBeenCalledTimes(1);
    expect(membersList).toHaveBeenCalledWith('MGconfigured');
    expect([...membership.entries()]).toEqual([
      ['+15550000001', 'MGconfigured'],
      ['+15550000002', 'MGconfigured'],
    ]);
  });

  it('walks every service on the account when none is configured', async () => {
    const { service, servicesList } = makeService({
      services: {
        MGa: ['+15550000001'],
        MGb: ['+15550000002', '+15550000001'],
      },
    });

    const membership = await service.messagingServiceMembership();

    expect(servicesList).toHaveBeenCalledTimes(1);
    expect(membership.get('+15550000001')).toBe('MGa'); // first listed wins
    expect(membership.get('+15550000002')).toBe('MGb');
  });

  it('is best-effort: a Messaging API failure yields an empty map, not an error', async () => {
    const { service } = makeService({
      services: { MGa: ['+15550000001'] },
      membershipError: Object.assign(new Error('Service Unavailable'), { status: 503 }),
    });
    await expect(service.messagingServiceMembership()).resolves.toEqual(new Map());
  });
});

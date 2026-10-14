/**
 * `DispatchMapService.read` — what `GET /deals/map` answers: the jobs the
 * board draws, and beside them who those jobs name, so the browser makes no
 * second round trip (it used to drain the list, THEN ask crm for the clients).
 *
 * - the data scope holds: an `assigned_only` caller (a technician) gets only
 *   the jobs they are on, as on the jobs list;
 * - a job's own numbers travel only to a caller with `contacts.view_numbers`
 *   (the Jobs report's rule); the clients' numbers and emails are asked of crm
 *   AS THE CALLER, so crm masks them exactly as on its own screens;
 * - technicians come from the eligibility projection, names only;
 * - neither side-load can cost the map: a source that fails costs its names.
 */
import { BadRequestException } from '@nestjs/common';
import { JobSuperStatus, type Contact } from '@bitcrm/types';
import { DispatchMapService } from 'src/deals/map/dispatch-map.service';
import {
  createMockDeal,
  createMockInternalHttpService,
  createMockJwtUser,
  createMockTechnicianEligibilityRepository,
} from '../mocks';

const OPEN = [
  JobSuperStatus.SUBMITTED,
  JobSuperStatus.IN_PROGRESS,
  JobSuperStatus.PENDING,
  JobSuperStatus.DONE_PENDING_APPROVAL,
];

function contact(id: string, over: Partial<Contact> = {}): Contact {
  return {
    id,
    firstName: `First-${id}`,
    lastName: `Last-${id}`,
    phones: [`+1404555${id.replace(/\D/g, '').padStart(4, '0')}`],
    emails: [`${id}@example.test`],
    addresses: [],
    notes: 'never on the map',
    ...over,
  } as Contact;
}

describe('DispatchMapService.read', () => {
  let repository: { readMapJobs: jest.Mock };
  let internalHttp: ReturnType<typeof createMockInternalHttpService>;
  let eligibility: ReturnType<typeof createMockTechnicianEligibilityRepository>;
  let service: DispatchMapService;
  const caller = createMockJwtUser({ id: 'tech-me' });
  const allowed = { numbers: true, authorization: 'Bearer caller-token' };

  beforeEach(() => {
    repository = { readMapJobs: jest.fn().mockResolvedValue([]) };
    internalHttp = createMockInternalHttpService();
    eligibility = createMockTechnicianEligibilityRepository();
    service = new DispatchMapService(repository as any, internalHttp as any, eligibility as any);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  it('reads the four open statuses whole by default', async () => {
    await service.read({}, caller, 'all', allowed);

    expect(repository.readMapJobs).toHaveBeenCalledWith(
      OPEN.map((status) => ({ status })),
      { techId: undefined },
    );
  });

  it('a window bounds every status asked by visit day — Done / Canceled and the open ones alike', async () => {
    await service.read({ statuses: 'pending,done,canceled', from: '2026-10-11', to: '2026-10-17' }, caller, 'all', allowed);

    const window = { from: '2026-10-11', to: '2026-10-17' };
    // In the board's (Workiz's) status order: Done sits between In progress and Pending.
    expect(repository.readMapJobs).toHaveBeenCalledWith(
      [
        { status: JobSuperStatus.DONE, window },
        { status: JobSuperStatus.PENDING, window },
        { status: JobSuperStatus.CANCELED, window },
      ],
      { techId: undefined },
    );
  });

  it('the open statuses for the days the board shows (`from`/`to` with no statuses)', async () => {
    await service.read({ from: '2026-10-13', to: '2026-10-13' }, caller, 'all', allowed);
    const window = { from: '2026-10-13', to: '2026-10-13' };
    expect(repository.readMapJobs).toHaveBeenCalledWith(
      OPEN.map((status) => ({ status, window })),
      { techId: undefined },
    );
  });

  it('a windowed read of open statuses still says how many there are whatever the date ("out of N open jobs")', async () => {
    (repository as any).countMapJobs = jest.fn().mockResolvedValue(57);
    const answer = await service.read({ from: '2026-10-13' }, caller, 'assigned_only', allowed);
    expect(answer.totalAnyDate).toBe(57);
    expect((repository as any).countMapJobs).toHaveBeenCalledWith(OPEN, { techId: 'tech-me' });
  });

  it('no such count for a whole read (it IS the whole set), nor for Done / Canceled', async () => {
    (repository as any).countMapJobs = jest.fn().mockResolvedValue(57);
    expect((await service.read({}, caller, 'all', allowed)).totalAnyDate).toBeUndefined();
    expect((await service.read({ statuses: 'done', from: '2026-10-13' }, caller, 'all', allowed)).totalAnyDate).toBeUndefined();
    expect((repository as any).countMapJobs).not.toHaveBeenCalled();
  });

  it('a count that fails costs the count, never the map', async () => {
    (repository as any).countMapJobs = jest.fn().mockRejectedValue(new Error('throttled'));
    const answer = await service.read({ from: '2026-10-13' }, caller, 'all', allowed);
    expect(answer.totalAnyDate).toBeUndefined();
    expect(answer.deals).toEqual([]);
  });

  it('refuses Done without a window before reading anything', async () => {
    await expect(service.read({ statuses: 'done' }, caller, 'all', allowed)).rejects.toThrow(BadRequestException);
    expect(repository.readMapJobs).not.toHaveBeenCalled();
  });

  it('holds an `assigned_only` caller to the jobs they are on', async () => {
    await service.read({}, caller, 'assigned_only', allowed);

    expect(repository.readMapJobs).toHaveBeenCalledWith(expect.any(Array), { techId: 'tech-me' });
  });

  it('a job’s own numbers go only to a caller who may see numbers', async () => {
    repository.readMapJobs.mockResolvedValue([createMockDeal({ id: 'd1', phones: ['+14045550100'] })]);

    const shown = await service.read({}, caller, 'all', allowed);
    const masked = await service.read({}, caller, 'all', { ...allowed, numbers: false });

    expect(shown.deals[0].phones).toEqual(['+14045550100']);
    expect(masked.deals[0]).not.toHaveProperty('phones');
    expect(masked.deals[0].id).toBe('d1');
  });

  it('a job’s own first number ("This job only") likewise', async () => {
    repository.readMapJobs.mockResolvedValue([createMockDeal({ id: 'd1', clientPhone: '+12035550123' })]);

    const shown = await service.read({}, caller, 'all', allowed);
    const masked = await service.read({}, caller, 'all', { ...allowed, numbers: false });

    expect(shown.deals[0].clientPhone).toBe('+12035550123');
    expect(masked.deals[0]).not.toHaveProperty('clientPhone');
  });

  it('carries the clients as crm shows them to the caller — names, numbers, emails, masked as crm masks', async () => {
    repository.readMapJobs.mockResolvedValue([
      createMockDeal({ id: 'd1', contactId: 'c1' }),
      createMockDeal({ id: 'd2', contactId: 'c2' }),
      createMockDeal({ id: 'd3', contactId: 'c1' }),
    ]);
    internalHttp.getContactsAsCaller.mockResolvedValue([
      contact('c1'),
      contact('c2', { phones: [], phonesMasked: true, phoneCount: 2 } as Partial<Contact>),
    ]);

    const { included } = await service.read({}, caller, 'all', allowed);

    expect(internalHttp.getContactsAsCaller).toHaveBeenCalledTimes(1);
    expect(internalHttp.getContactsAsCaller).toHaveBeenCalledWith(['c1', 'c2'], 'Bearer caller-token');
    expect(included.clients).toEqual([
      { id: 'c1', firstName: 'First-c1', lastName: 'Last-c1', phones: ['+14045550001'], emails: ['c1@example.test'] },
      { id: 'c2', firstName: 'First-c2', lastName: 'Last-c2', phones: [], emails: ['c2@example.test'], phonesMasked: true },
    ]);
    expect(internalHttp.getContactNames).not.toHaveBeenCalled();
  });

  it('names the clients crm would not show the caller, without their numbers', async () => {
    repository.readMapJobs.mockResolvedValue([
      createMockDeal({ id: 'd1', contactId: 'c1' }),
      createMockDeal({ id: 'd2', contactId: 'c2' }),
    ]);
    internalHttp.getContactsAsCaller.mockResolvedValue([contact('c1')]);
    internalHttp.getContactNames.mockResolvedValue([{ id: 'c2', firstName: 'Bo', lastName: 'Named' }]);

    const { included } = await service.read({}, caller, 'all', allowed);

    expect(internalHttp.getContactNames).toHaveBeenCalledWith(['c2']);
    expect(included.clients.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(included.clients[1]).toEqual({ id: 'c2', firstName: 'Bo', lastName: 'Named', phones: [], emails: [] });
  });

  it('asks crm a hundred clients a body, the bodies at once', async () => {
    const deals = Array.from({ length: 250 }, (_, i) => createMockDeal({ id: `d${i}`, contactId: `c${i}` }));
    repository.readMapJobs.mockResolvedValue(deals);
    internalHttp.getContactsAsCaller.mockImplementation(async (ids: string[]) => ids.map((id) => contact(id)));

    const { included } = await service.read({}, caller, 'all', allowed);

    const bodies = internalHttp.getContactsAsCaller.mock.calls.map((c: any[]) => c[0].length);
    expect(bodies).toEqual([100, 100, 50]);
    expect(included.clients).toHaveLength(250);
  });

  it('names the technicians on the jobs from the eligibility projection — names only', async () => {
    repository.readMapJobs.mockResolvedValue([
      createMockDeal({ id: 'd1', assignedTechIds: ['t1', 't2'] }),
      createMockDeal({ id: 'd2', assignedTechIds: ['t2'] }),
    ]);
    eligibility.getMany.mockResolvedValue([
      { technicianId: 't1', firstName: 'Daniel', lastName: 'Munoz', workizName: '(2) TX - Daniel Munoz', department: 'Field', homeAddress: { lat: 1, lng: 2 }, jobTypeIds: [], serviceAreaIds: [], assignable: true, updatedAt: '' },
      { technicianId: 't2', firstName: 'Ana', lastName: 'Tech', jobTypeIds: [], serviceAreaIds: [], assignable: true, updatedAt: '' },
    ]);

    const { included } = await service.read({}, caller, 'all', allowed);

    expect(eligibility.getMany).toHaveBeenCalledWith(['t1', 't2']);
    expect(included.technicians).toEqual([
      { id: 't1', firstName: 'Daniel', lastName: 'Munoz', workizName: '(2) TX - Daniel Munoz' },
      { id: 't2', firstName: 'Ana', lastName: 'Tech' },
    ]);
  });

  it('a side-load that fails costs its names, never the map', async () => {
    repository.readMapJobs.mockResolvedValue([createMockDeal({ id: 'd1', contactId: 'c1', assignedTechIds: ['t1'] })]);
    eligibility.getMany.mockRejectedValue(new Error('dynamo down'));
    internalHttp.getContactsAsCaller.mockResolvedValue([]);
    internalHttp.getContactNames.mockResolvedValue([]);

    const result = await service.read({}, caller, 'all', allowed);

    expect(result.deals.map((d) => d.id)).toEqual(['d1']);
    expect(result.included).toEqual({ technicians: [], clients: [] });
  });

  it('asks nobody about an empty map', async () => {
    const result = await service.read({}, caller, 'all', allowed);

    expect(result).toEqual({ deals: [], included: { technicians: [], clients: [] } });
    expect(internalHttp.getContactsAsCaller).not.toHaveBeenCalled();
    expect(eligibility.getMany).not.toHaveBeenCalled();
  });
});

describe('DispatchMapService — the answer shared through Redis for 10 s', () => {
  const caller = createMockJwtUser({ id: 'disp-1' });
  const opts = { numbers: true, authorization: 'Bearer t', contacts: { view: true, scope: 'all' } };

  function setup() {
    const store = new Map<string, string>();
    const redis = {
      client: {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string, ..._rest: unknown[]) => {
          store.set(k, v);
          return 'OK';
        }),
      },
    };
    const repository = {
      readMapJobs: jest.fn().mockResolvedValue([createMockDeal({ id: 'd1', contactId: 'c1' })]),
      countMapJobs: jest.fn().mockResolvedValue(3),
    };
    const internalHttp = createMockInternalHttpService();
    (internalHttp as any).getContactsAsCaller = jest.fn().mockResolvedValue([contact('c1')]);
    const eligibility = createMockTechnicianEligibilityRepository();
    const service = new DispatchMapService(repository as any, internalHttp as any, eligibility as any, redis as any);
    return { service, repository, redis, store };
  }

  it('a second identical read within the TTL is served from Redis, identical', async () => {
    const { service, repository, redis } = setup();
    const first = await service.read({ from: '2026-10-13' }, caller, 'all', opts);
    const second = await service.read({ from: '2026-10-13' }, caller, 'all', opts);
    expect(second).toEqual(first);
    expect(repository.readMapJobs).toHaveBeenCalledTimes(1);
    const answerSet = redis.client.set.mock.calls.find((c) => String(c[0]).startsWith('deal:map:v1:')) as unknown[];
    expect(answerSet.slice(2)).toEqual(['EX', 10]);
    // The any-date count beside it (a windowed read) is kept 30 s, apart from the answer.
    const totalSet = redis.client.set.mock.calls.find((c) => String(c[0]).startsWith('deal:map:total:v1:')) as unknown[];
    expect(totalSet.slice(1)).toEqual(['3', 'EX', 30]);
    expect(second.totalAnyDate).toBe(3);
  });

  it('keyed by window, statuses and everything about the caller that changes the answer', async () => {
    const { service, repository } = setup();
    await service.read({ from: '2026-10-13' }, caller, 'all', opts);
    await service.read({ from: '2026-10-14' }, caller, 'all', opts);
    await service.read({}, caller, 'all', opts);
    await service.read({ from: '2026-10-13' }, caller, 'assigned_only', opts);
    await service.read({ from: '2026-10-13' }, caller, 'all', { ...opts, numbers: false });
    await service.read({ from: '2026-10-13' }, caller, 'all', { ...opts, contacts: { view: false, scope: 'all' } });
    expect(repository.readMapJobs).toHaveBeenCalledTimes(6);
    // A narrower contacts scope is personal: crm answers by who is asking.
    await service.read({ from: '2026-10-13' }, caller, 'all', { ...opts, contacts: { view: true, scope: 'assigned_only' } });
    await service.read({ from: '2026-10-13' }, createMockJwtUser({ id: 'disp-2' }), 'all', { ...opts, contacts: { view: true, scope: 'assigned_only' } });
    expect(repository.readMapJobs).toHaveBeenCalledTimes(8);
  });

  it('any job written since (the generation the cache bumps) is a miss', async () => {
    const { service, repository, store } = setup();
    await service.read({}, caller, 'all', opts);
    store.set('deal:map:gen', '7');
    await service.read({}, caller, 'all', opts);
    expect(repository.readMapJobs).toHaveBeenCalledTimes(2);
  });

  it('Redis down costs the cache, never the map', async () => {
    const { service, repository, redis } = setup();
    redis.client.get.mockRejectedValue(new Error('ECONNREFUSED'));
    redis.client.set.mockRejectedValue(new Error('ECONNREFUSED'));
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.read({}, caller, 'all', opts)).resolves.toMatchObject({ deals: [expect.objectContaining({ id: 'd1' })] });
    expect(repository.readMapJobs).toHaveBeenCalledTimes(1);
  });
});

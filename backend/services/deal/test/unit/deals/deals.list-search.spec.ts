/**
 * `GET /deals` and `GET /deals/counts` the Workiz way (jobslist notes, probed
 * live 2026-10-08):
 *
 *  - `q` — the Search box: server-side, inside the open tab and every other
 *    filter, fully paged, and the tab's count chip is the found count, so the
 *    counts take it too. Phone digits only for a caller who may see numbers.
 *  - "Filter results": several picks in one group are any-of, groups AND —
 *    `techIds`, `jobTypeIds`, `serviceAreas`, `businessProfileIds` as comma
 *    lists, `tagMatch=any` beside `tagIds`. One value travels as before.
 *
 * And the client's half of the search attributes, which crm owns: brought
 * along on create, on a client change and a merge, and restamped on every job
 * of a client when crm says the client changed (`contact.updated`).
 */
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClientType, JobSuperStatus, type Deal } from '@bitcrm/types';
import { ListDealsQueryDto } from 'src/deals/dto/list-deals-query.dto';
import { DealsService } from 'src/deals/deals.service';
import {
  createMockDeal,
  createMockDealsCacheService,
  createMockDealsRepository,
  createMockGeocodingService,
  createMockInternalHttpService,
  createMockJobType,
  createMockJwtUser,
  createMockCustomFieldsService,
  createMockTimelineRepository,
} from '../mocks';

const caller = createMockJwtUser({ id: 'dispatcher-1' });

function makeService() {
  const repo = createMockDealsRepository();
  const cache = createMockDealsCacheService() as ReturnType<typeof createMockDealsCacheService> & {
    getJson: jest.Mock;
    setJson: jest.Mock;
  };
  cache.getJson = jest.fn().mockResolvedValue(null);
  cache.setJson = jest.fn();
  const timeline = createMockTimelineRepository();
  const http = createMockInternalHttpService();
  const jobTypes = {
    findById: jest.fn().mockResolvedValue(createMockJobType()),
    list: jest.fn().mockResolvedValue([
      createMockJobType({ id: 'jt-service', name: 'Service Call' }),
      createMockJobType({ id: 'jt-rekey', name: 'Rekey' }),
      createMockJobType({ id: 'jt-old', name: 'Old service (archived)', active: false }),
    ]),
  };
  const stub = {} as any;
  const service = new DealsService(
    repo as any,
    cache as any,
    timeline as any,
    stub,
    http as any,
    createMockGeocodingService() as any,
    { resolvePoint: jest.fn().mockResolvedValue(null), findById: jest.fn() } as any,
    jobTypes as any,
    stub,
    stub,
    { list: jest.fn().mockResolvedValue([]) } as any,
    stub,
    createMockCustomFieldsService() as any,
    stub,
  );
  repo.findBySchedule.mockResolvedValue({ items: [], nextCursor: undefined });
  repo.countBySchedule.mockResolvedValue(0);
  return { service, repo, cache, http, jobTypes, timeline };
}

/** The filters the list handed to the schedule index. */
const filtersOf = (repo: ReturnType<typeof createMockDealsRepository>) => repo.findBySchedule.mock.calls[0][4];

const tab = { superStatus: JobSuperStatus.SUBMITTED, sort: 'schedule' as const };

describe('ListDealsQueryDto — the new parameters', () => {
  const errorsOf = async (payload: object) =>
    (await validate(plainToInstance(ListDealsQueryDto, payload), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

  it('takes q, the comma lists and tagMatch', async () => {
    expect(
      await errorsOf({
        q: 'dustin',
        techIds: 'a,b',
        jobTypeIds: 'a,b',
        serviceAreas: 'Dallas,Fort Worth',
        businessProfileIds: 'bp1,bp2',
        tagIds: 'x,y',
        tagMatch: 'any',
      }),
    ).toEqual([]);
    expect(await errorsOf({ tagMatch: 'all' })).toEqual([]);
  });

  it('refuses a tagMatch it does not know', async () => {
    expect(await errorsOf({ tagMatch: 'some' })).toEqual(['tagMatch']);
  });
});

describe('q on the jobs list', () => {
  it('travels to the repository folded, with the catalog job types whose name contains it', async () => {
    const { service, repo } = makeService();

    await service.list({ ...tab, q: '  SERV ' } as any, caller, undefined, { numbers: true });

    expect(filtersOf(repo).text).toEqual({ text: 'serv', jobTypeIds: ['jt-service', 'jt-old'] });
  });

  it('a text no job type is called carries no job types', async () => {
    const { service, repo } = makeService();
    await service.list({ ...tab, q: 'Dustin' } as any, caller, undefined, { numbers: true });
    expect(filtersOf(repo).text).toEqual({ text: 'dustin' });
  });

  it('phone-shaped text also matches the numbers — for a caller who may see them', async () => {
    const allowed = makeService();
    await allowed.service.list({ ...tab, q: '469 396' } as any, caller, undefined, { numbers: true });
    expect(filtersOf(allowed.repo).text).toEqual({ text: '469 396', digits: '469396' });

    const masked = makeService();
    await masked.service.list({ ...tab, q: '469 396' } as any, caller, undefined, { numbers: false });
    expect(filtersOf(masked.repo).text).toEqual({ text: '469 396' });
  });

  it('without q there is no search and no catalog read', async () => {
    const { service, repo, jobTypes } = makeService();
    await service.list({ ...tab } as any, caller, undefined, { numbers: true });
    expect(filtersOf(repo).text).toBeUndefined();
    expect(jobTypes.list).not.toHaveBeenCalled();
  });

  it('stays inside the tab and the other filters', async () => {
    const { service, repo } = makeService();
    await service.list({ ...tab, q: 'dustin', unpaid: 'true', tagIds: 't1' } as any, caller, undefined, { numbers: true });
    expect(repo.findBySchedule).toHaveBeenCalledWith(
      [JobSuperStatus.SUBMITTED],
      expect.anything(),
      expect.any(Number),
      undefined,
      expect.objectContaining({ text: { text: 'dustin' }, unpaid: true, tagIds: ['t1'] }),
      'asc',
    );
  });

  it('a Job ID lookup with q beside it checks the text on the row it found', async () => {
    const { service, repo } = makeService();
    repo.findIdByNumber.mockResolvedValue('d1');
    repo.findByIds.mockResolvedValue([]);

    const page = await service.list({ search: 'K4T9ZW', q: 'dustin' } as any, caller, undefined, { numbers: true });

    expect(page.items).toEqual([]);
    expect(repo.findByIds).toHaveBeenCalledWith(['d1'], expect.objectContaining({ text: { text: 'dustin' } }));
  });
});

describe('Filter results — several values per group', () => {
  it('comma lists become any-of filters, trimmed and once each', async () => {
    const { service, repo } = makeService();

    await service.list(
      {
        ...tab,
        techIds: 'a, b,a',
        jobTypeIds: 'jt-1,jt-2',
        serviceAreas: 'Dallas, Fort Worth',
        businessProfileIds: 'bp-1,,bp-2',
        tagIds: 'x,y',
        tagMatch: 'any',
      } as any,
      caller,
    );

    expect(filtersOf(repo)).toEqual(
      expect.objectContaining({
        techIds: ['a', 'b'],
        jobTypeIds: ['jt-1', 'jt-2'],
        serviceAreas: ['Dallas', 'Fort Worth'],
        businessProfileIds: ['bp-1', 'bp-2'],
        tagIds: ['x', 'y'],
        tagMatch: 'any',
      }),
    );
  });

  it('one value travels exactly as before', async () => {
    const { service, repo } = makeService();
    await service.list({ ...tab, jobTypeId: 'jt-1', serviceArea: 'Dallas', businessProfileId: 'bp-1', techId: 't1', tagIds: 'x,y' } as any, caller);
    const f = filtersOf(repo);
    expect(f).toEqual(expect.objectContaining({ jobTypeId: 'jt-1', serviceArea: 'Dallas', businessProfileId: 'bp-1', techId: 't1', tagIds: ['x', 'y'] }));
    expect(f.jobTypeIds).toBeUndefined();
    expect(f.serviceAreas).toBeUndefined();
    expect(f.businessProfileIds).toBeUndefined();
    expect(f.techIds).toBeUndefined();
    expect(f.tagMatch).toBeUndefined();
  });

  it('the single value and the list of one group are one group', async () => {
    const { service, repo } = makeService();
    await service.list({ ...tab, jobTypeId: 'jt-1', jobTypeIds: 'jt-2,jt-3' } as any, caller);
    expect(filtersOf(repo).jobTypeIds).toEqual(['jt-1', 'jt-2', 'jt-3']);
    expect(filtersOf(repo).jobTypeId).toBeUndefined();
  });

  it('an assigned_only caller’s technician picks only narrow their own jobs', async () => {
    const { service, repo } = makeService();
    await service.list({ ...tab, techIds: 'x,y' } as any, createMockJwtUser({ id: 'me' }), 'assigned_only');
    expect(filtersOf(repo)).toEqual(expect.objectContaining({ techId: 'me', techIds: ['x', 'y'] }));
  });

  it('more than fifty values in a group is a 400', async () => {
    const { service } = makeService();
    const many = Array.from({ length: 51 }, (_, i) => `t${i}`).join(',');
    await expect(service.list({ ...tab, techIds: many } as any, caller)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the Job ID lookup honours the lists', async () => {
    const { service, repo } = makeService();
    repo.findIdByNumber.mockResolvedValue('d1');
    repo.findByIds.mockResolvedValue([createMockDeal({ id: 'd1', jobTypeId: 'jt-9', tagIds: ['y'] })]);

    const miss = await service.list({ search: 'K4T9ZW', jobTypeIds: 'jt-1,jt-2' } as any, caller);
    expect(miss.items).toEqual([]);

    const hit = await service.list({ search: 'K4T9ZW', jobTypeIds: 'jt-1,jt-9', tagIds: 'x,y', tagMatch: 'any' } as any, caller);
    expect(hit.items.map((d: Deal) => d.id)).toEqual(['d1']);
  });
});

describe('counts under q and the lists', () => {
  it('count the search inside every tab, exactly as the list filters it', async () => {
    const { service, repo } = makeService();
    await service.counts({ q: 'dustin', techIds: 'a,b' } as any, caller, undefined, { numbers: true });
    expect(repo.countBySchedule).toHaveBeenCalled();
    for (const call of repo.countBySchedule.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ text: { text: 'dustin' }, techIds: ['a', 'b'] }));
    }
  });

  it('a closed status is not counted under a search without a window — that would read all of it', async () => {
    const { service, repo } = makeService();
    repo.countBySchedule.mockResolvedValue(3);

    const counts = await service.counts({ q: 'dustin' } as any, caller, undefined, { numbers: true });

    expect(counts.done).toBeNull();
    expect(counts.canceled).toBeNull();
    expect(counts.total).toBeNull();
    expect(counts.submitted).toBe(3);
    const counted = repo.countBySchedule.mock.calls.map((c) => c[0]);
    expect(counted).not.toContain(JobSuperStatus.DONE);
    expect(counted).not.toContain(JobSuperStatus.CANCELED);
  });

  it('with a visit-date window the closed statuses are counted under the search too', async () => {
    const { service, repo } = makeService();
    repo.countBySchedule.mockResolvedValue(1);
    const counts = await service.counts({ q: 'dustin', scheduledFrom: '2026-10-01', scheduledTo: '2026-10-07' } as any, caller, undefined, { numbers: true });
    expect(counts.done).toBe(1);
    expect(counts.canceled).toBe(1);
  });

  it('without q nothing changes: the closed statuses are counted up to their ceiling', async () => {
    const { service, repo } = makeService();
    repo.countBySchedule.mockResolvedValue(2);
    const counts = await service.counts({} as any, caller);
    expect(counts.done).toBe(2);
  });
});

describe('the client’s half of the search attributes', () => {
  const contact = {
    id: 'c1',
    firstName: 'Ann',
    lastName: 'Lee',
    phones: ['+12145550100'],
    emails: ['ann@x.com'],
    companyId: 'co-1',
  };
  const createBody = {
    contactId: 'c1',
    clientType: ClientType.RESIDENTIAL,
    address: { street: '1 Elm', city: 'Plano', state: 'TX', zip: '75023' },
    jobTypeId: 'jobtype-1',
  };

  it('create brings it along from crm — and never hands it back in the job', async () => {
    const { service, repo, http } = makeService();
    repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
    http.getContact.mockResolvedValue(contact);
    http.getCompany.mockResolvedValue({ id: 'co-1', title: 'Lee Holdings' });

    const deal = await service.create(createBody as any, caller);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientSearchText: 'ann lee\nann@x.com\nlee holdings', clientSearchDigits: '12145550100' }),
    );
    expect(deal).not.toHaveProperty('clientSearchText');
  });

  it('create still succeeds when crm cannot say — the job is found by its own fields until crm’s next event', async () => {
    const { service, repo, http } = makeService();
    repo.reserveDealNumber.mockResolvedValue('K4T9ZW');
    http.getContact.mockRejectedValue(new Error('crm down'));

    await service.create(createBody as any, caller);

    expect(repo.create).toHaveBeenCalled();
    expect(repo.create.mock.calls[0][0]).not.toHaveProperty('clientSearchText');
  });

  it('contact.updated restamps every job of the client', async () => {
    const { service, repo, http } = makeService();
    http.getContact.mockResolvedValue(contact);
    http.getCompany.mockResolvedValue(null);
    repo.restampClientSearch.mockResolvedValue(4);

    expect(await service.refreshClientSearch('c1')).toBe(4);
    expect(repo.restampClientSearch).toHaveBeenCalledWith('c1', { clientSearchText: 'ann lee\nann@x.com', clientSearchDigits: '12145550100' });
  });

  it('a client crm no longer has changes nothing', async () => {
    const { service, repo, http } = makeService();
    http.getContact.mockResolvedValue(null);
    expect(await service.refreshClientSearch('gone')).toBe(0);
    expect(repo.restampClientSearch).not.toHaveBeenCalled();
  });

  it('crm being down fails the event, so SQS delivers it again', async () => {
    const { service, http } = makeService();
    http.getContact.mockRejectedValue(new Error('crm down'));
    await expect(service.refreshClientSearch('c1')).rejects.toThrow('crm down');
  });

  it('moving a job to another client brings that client’s half', async () => {
    const { service, repo, http } = makeService();
    repo.findById.mockResolvedValue(createMockDeal({ id: 'd1', contactId: 'old' }));
    http.getContact.mockResolvedValue(contact);

    await service.changeContact('d1', 'c1', caller);

    expect(repo.setClientSearch).toHaveBeenCalledWith('d1', expect.objectContaining({ clientSearchText: 'ann lee\nann@x.com' }));
  });

  it('a merge brings the surviving client’s half to every job it moves', async () => {
    const { service, repo, http } = makeService();
    repo.findByContact.mockResolvedValue({ items: [createMockDeal({ id: 'a' }), createMockDeal({ id: 'b' })], nextCursor: undefined });
    http.getContact.mockResolvedValue(contact);

    await service.reassignContact('old', 'c1');

    expect(repo.setClientSearch.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(http.getContact).toHaveBeenCalledTimes(1);
  });
});

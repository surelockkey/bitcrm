/**
 * Catalog lists are read on every page load and by other services'
 * `/internal` routes; after the Workiz import the job-type catalog alone is
 * 898 rows. Each catalog service keeps its full list in memory
 * (`CatalogCache`, 60 s, single-flight), drops it on every write it takes,
 * and derives `activeOnly` from the cached list instead of re-querying.
 */
import { ServiceAreaType } from '@bitcrm/types';
import { JobTypesService } from 'src/job-types/job-types.service';
import { JobSourcesService } from 'src/job-sources/job-sources.service';
import { JobTagsService } from 'src/job-tags/job-tags.service';
import { CustomFieldsService } from 'src/custom-fields/custom-fields.service';
import { JobStatusesService } from 'src/job-statuses/job-statuses.service';
import { ServiceAreasService } from 'src/service-areas/service-areas.service';
import { ExternalCompaniesService } from 'src/external-companies/external-companies.service';
import { ClientTagsService } from 'src/client-tags/client-tags.service';
import {
  createMockJobTypesRepository,
  createMockJobSourcesRepository,
  createMockJobTagsRepository,
  createMockCustomFieldsRepository,
  createMockServiceAreasRepository,
  createMockExternalCompaniesRepository,
  createMockClientTagsRepository,
  createMockGeocodingService,
  createMockJobType,
  createMockJobSource,
  createMockJobTag,
  createMockCustomField,
  createMockServiceArea,
  createMockExternalCompany,
  createMockClientTag,
  createMockJwtUser,
} from '../mocks';

const caller = createMockJwtUser();

interface Case {
  service: { list: (...a: any[]) => Promise<{ id: string }[]> } & Record<string, any>;
  repo: { listAll: jest.Mock; get: jest.Mock } & Record<string, jest.Mock>;
  rows: any[];
  createDto: Record<string, unknown>;
}

function statusesRepo() {
  return {
    create: jest.fn(),
    put: jest.fn(),
    get: jest.fn(),
    listAll: jest.fn().mockResolvedValue([]),
    isReferencedByDeal: jest.fn().mockResolvedValue(false),
    remove: jest.fn(),
  };
}

const cases: [string, () => Case][] = [
  ['JobTypesService', () => {
    const repo = createMockJobTypesRepository();
    return {
      repo, service: new JobTypesService(repo as any),
      rows: [createMockJobType({ id: 'a', name: 'B', priority: 0 }), createMockJobType({ id: 'b', name: 'A', priority: 5, active: false })],
      createDto: { name: 'New' },
    };
  }],
  ['JobSourcesService', () => {
    const repo = createMockJobSourcesRepository();
    return {
      repo, service: new JobSourcesService(repo as any),
      rows: [createMockJobSource({ id: 'a', name: 'B', priority: 0 }), createMockJobSource({ id: 'b', name: 'A', priority: 5, active: false })],
      createDto: { name: 'New' },
    };
  }],
  ['JobTagsService', () => {
    const repo = createMockJobTagsRepository();
    return {
      repo, service: new JobTagsService(repo as any),
      rows: [createMockJobTag({ id: 'a', name: 'B', priority: 0 }), createMockJobTag({ id: 'b', name: 'A', priority: 5 })],
      createDto: { name: 'New' },
    };
  }],
  ['CustomFieldsService', () => {
    const repo = createMockCustomFieldsRepository();
    return {
      repo, service: new CustomFieldsService(repo as any),
      rows: [createMockCustomField({ id: 'a', name: 'B', priority: 0 }), createMockCustomField({ id: 'b', name: 'A', priority: 5 })],
      createDto: { name: 'New', type: 'text' },
    };
  }],
  ['JobStatusesService', () => {
    const repo = statusesRepo();
    const row = (id: string, name: string, priority: number) => ({
      id, name, priority, group: 'submitted', color: 'slate', active: true, createdBy: 'u', createdAt: 'x', updatedAt: 'x',
    });
    return {
      repo, service: new JobStatusesService(repo as any),
      rows: [row('a', 'B', 0), row('b', 'A', 5)],
      createDto: { name: 'New', group: 'submitted' },
    };
  }],
  ['ServiceAreasService', () => {
    const repo = createMockServiceAreasRepository();
    return {
      repo, service: new ServiceAreasService(repo as any, createMockGeocodingService() as any),
      rows: [createMockServiceArea({ id: 'a', name: 'B', priority: 0, coverage: [] }), createMockServiceArea({ id: 'b', name: 'A', priority: 5, coverage: [] })],
      createDto: { name: 'New', type: ServiceAreaType.ZIPS, zips: [{ zip: '30301', radiusMiles: 5 }], active: false },
    };
  }],
  ['ExternalCompaniesService', () => {
    const repo = createMockExternalCompaniesRepository();
    return {
      repo, service: new ExternalCompaniesService(repo as any),
      rows: [createMockExternalCompany({ id: 'a', name: 'B' }), createMockExternalCompany({ id: 'b', name: 'A' })],
      createDto: { name: 'New' },
    };
  }],
  ['ClientTagsService', () => {
    const repo = createMockClientTagsRepository();
    return {
      repo, service: new ClientTagsService(repo as any),
      rows: [createMockClientTag({ id: 'a', name: 'B', priority: 0 }), createMockClientTag({ id: 'b', name: 'A', priority: 5 })],
      createDto: { name: 'New' },
    };
  }],
];

describe.each(cases)('%s list cache', (_name, make) => {
  let c: Case;

  beforeEach(() => {
    c = make();
    c.repo.listAll.mockResolvedValue(c.rows);
    c.repo.get.mockResolvedValue(c.rows[0]);
  });

  it('serves repeated lists from memory, in the same order', async () => {
    const first = await c.service.list();
    const second = await c.service.list();

    expect(c.repo.listAll).toHaveBeenCalledTimes(1);
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
    // Priority desc (where the catalog has one), then name: 'b' first either way.
    expect(first.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('concurrent lists share one read', async () => {
    await Promise.all([c.service.list(), c.service.list(), c.service.list()]);
    expect(c.repo.listAll).toHaveBeenCalledTimes(1);
  });

  it.each(['create', 'update', 'remove'] as const)('%s drops the cached list', async (op) => {
    await c.service.list();
    if (op === 'create') await c.service.create(c.createDto, caller);
    if (op === 'update') await c.service.update('a', { priority: 9 }, caller);
    if (op === 'remove') await c.service.remove('a', caller);
    const afterWrite = c.repo.listAll.mock.calls.length;

    await c.service.list();

    expect(c.repo.listAll).toHaveBeenCalledTimes(afterWrite + 1);
  });

  it('a failed read is not cached', async () => {
    c.repo.listAll.mockRejectedValueOnce(new Error('throttled'));
    await expect(c.service.list()).rejects.toThrow('throttled');
    await expect(c.service.list()).resolves.toHaveLength(2);
  });
});

describe.each([
  ['JobTypesService', () => {
    const repo = createMockJobTypesRepository();
    return { repo, service: new JobTypesService(repo as any) };
  }],
  ['JobSourcesService', () => {
    const repo = createMockJobSourcesRepository();
    return { repo, service: new JobSourcesService(repo as any) };
  }],
] as [string, () => { repo: any; service: any }][])('%s activeOnly', (_name, make) => {
  it('is derived from the cached full list, not a second query', async () => {
    const { repo, service } = make();
    repo.listAll.mockResolvedValue([
      { id: 'on2', name: 'Z', priority: 1, active: true },
      { id: 'off', name: 'A', priority: 9, active: false },
      { id: 'on1', name: 'B', priority: 9, active: true },
    ]);

    const all = await service.list();
    const active = await service.list({ activeOnly: true });

    expect(all.map((r: any) => r.id)).toEqual(['off', 'on1', 'on2']);
    expect(active.map((r: any) => r.id)).toEqual(['on1', 'on2']);
    expect(repo.listAll).toHaveBeenCalledTimes(1);
    expect(repo.listAll).toHaveBeenCalledWith();
  });
});

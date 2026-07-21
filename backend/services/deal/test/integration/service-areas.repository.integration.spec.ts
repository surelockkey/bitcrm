import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { ServiceAreaType, type ServiceArea } from '@bitcrm/types';
import { ServiceAreasRepository } from '../../src/service-areas/service-areas.repository';
import {
  createTestTables,
  clearTestTable,
  getTestDynamoDbClient,
  DEALS_TEST_TABLE,
} from './setup';

jest.mock('../../src/common/constants/dynamo.constants', () => ({
  DEALS_TABLE: 'BitCRM_Deals_Test',
  DEALS_GSI1_NAME: 'StageIndex',
  DEALS_GSI2_NAME: 'TechIndex',
  DEALS_GSI3_NAME: 'ContactIndex',
  DEALS_GSI4_NAME: 'DispatcherIndex',
}));

function makeArea(overrides: Partial<ServiceArea> = {}): ServiceArea {
  return {
    id: 'area-1',
    name: 'Atlanta',
    priority: 0,
    active: true,
    type: ServiceAreaType.POLYGON,
    definition: { type: ServiceAreaType.POLYGON, vertices: [
      { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 },
    ] },
    coverage: [{ kind: 'polygon', vertices: [
      { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 },
    ] }],
    createdBy: 'admin-1',
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('ServiceAreasRepository (integration)', () => {
  let repo: ServiceAreasRepository;

  beforeAll(async () => {
    await createTestTables();
    const db = getTestDynamoDbClient();
    const mod = await Test.createTestingModule({
      providers: [
        ServiceAreasRepository,
        { provide: DynamoDbService, useValue: { client: db } },
      ],
    }).compile();
    repo = mod.get(ServiceAreasRepository);
  });

  afterAll(async () => clearTestTable(DEALS_TEST_TABLE));
  beforeEach(async () => clearTestTable(DEALS_TEST_TABLE));

  it('creates, reads, lists and removes areas via the catalog GSI', async () => {
    await repo.create(makeArea({ id: 'a1', name: 'Alpha', priority: 1 }));
    await repo.create(makeArea({ id: 'a2', name: 'Bravo', priority: 2 }));

    expect(await repo.get('a1')).toMatchObject({ id: 'a1', name: 'Alpha' });
    const all = await repo.listAll();
    expect(all.map((a) => a.id).sort()).toEqual(['a1', 'a2']);

    await repo.remove('a1');
    expect(await repo.get('a1')).toBeNull();
    expect(await repo.listAll()).toHaveLength(1);
  });

  it('rejects a duplicate id on create', async () => {
    await repo.create(makeArea({ id: 'dup' }));
    await expect(repo.create(makeArea({ id: 'dup' }))).rejects.toThrow();
  });

  it('put replaces an existing area', async () => {
    await repo.create(makeArea({ id: 'p1', name: 'Old' }));
    await repo.put(makeArea({ id: 'p1', name: 'New', priority: 9 }));
    const area = await repo.get('p1');
    expect(area).toMatchObject({ name: 'New', priority: 9 });
  });
});

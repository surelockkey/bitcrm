import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { ClientType, CrmStatus, type Company } from '@bitcrm/types';
import { CompaniesRepository } from 'src/companies/companies.repository';
import {
  COMPANIES_TEST_TABLE,
  getTestDynamoDbClient,
  createTestTables,
  clearTestTable,
  destroyRawClient,
} from './setup';

describe('CompaniesRepository (integration)', () => {
  let repository: CompaniesRepository;

  const makeCompany = (overrides?: Partial<Company>): Company => ({
    id: 'company-1',
    title: 'Acme Corp',
    phones: ['+14045559999'],
    emails: ['info@acme.com'],
    address: '456 Business Ave',
    clientType: ClientType.COMMERCIAL,
    status: CrmStatus.ACTIVE,
    createdBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTables();

    const module = await Test.createTestingModule({
      providers: [
        CompaniesRepository,
        { provide: DynamoDbService, useValue: { client: getTestDynamoDbClient() } },
      ],
    }).compile();

    repository = module.get(CompaniesRepository);
    (repository as any).tableName = COMPANIES_TEST_TABLE;
  });

  afterAll(() => {
    destroyRawClient();
  });

  beforeEach(async () => {
    await clearTestTable(COMPANIES_TEST_TABLE);
  });

  describe('create + findById roundtrip', () => {
    it('should persist and retrieve a company', async () => {
      const company = makeCompany();
      await repository.create(company);

      const found = await repository.findById('company-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('company-1');
      expect(found!.title).toBe('Acme Corp');
      expect(found!.clientType).toBe(ClientType.COMMERCIAL);
    });
  });

  describe('findByClientType', () => {
    it('should find companies by client type via GSI1', async () => {
      await repository.create(makeCompany({ id: 'c-1', clientType: ClientType.COMMERCIAL }));
      await repository.create(makeCompany({ id: 'c-2', clientType: ClientType.COMMERCIAL }));
      await repository.create(makeCompany({ id: 'c-3', clientType: ClientType.GOVERNMENT }));

      const result = await repository.findByClientType(ClientType.COMMERCIAL, 10);

      expect(result.items).toHaveLength(2);
      const ids = result.items.map((c) => c.id).sort();
      expect(ids).toEqual(['c-1', 'c-2']);
    });
  });

  describe('findAll', () => {
    it('should return all active companies with pagination', async () => {
      await repository.create(makeCompany({ id: 'c-1' }));
      await repository.create(makeCompany({ id: 'c-2' }));

      const result = await repository.findAll(10);

      expect(result.items.length).toBe(2);
    });

    it('should respect limit and return cursor', async () => {
      await repository.create(makeCompany({ id: 'c-1' }));
      await repository.create(makeCompany({ id: 'c-2' }));
      await repository.create(makeCompany({ id: 'c-3' }));

      const page1 = await repository.findAll(2);

      expect(page1.items.length).toBe(2);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await repository.findAll(2, page1.nextCursor);

      expect(page2.items.length).toBe(1);
    });
  });

  describe('update', () => {
    it('should update company fields', async () => {
      await repository.create(makeCompany());

      const updated = await repository.update('company-1', { title: 'New Name' });

      expect(updated.title).toBe('New Name');
      expect(updated.clientType).toBe(ClientType.COMMERCIAL);
    });

    it('should rebuild GSI1 key when clientType changes', async () => {
      await repository.create(makeCompany());

      await repository.update('company-1', { clientType: ClientType.GOVERNMENT });

      const result = await repository.findByClientType(ClientType.GOVERNMENT, 10);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('company-1');
    });
  });
});

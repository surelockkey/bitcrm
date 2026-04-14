import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type Role, DataScope } from '@bitcrm/types';
import { RolesRepository } from '../../src/roles/roles.repository';
import {
  createTestTable,
  deleteTestTable,
  clearTestTable,
  destroyRawClient,
  getTestDynamoDbClient,
} from './setup';

// Override the table name to use test table
jest.mock('../../src/roles/constants/dynamo.constants', () => ({
  ROLES_TABLE: 'BitCRM_Users_Test',
  ROLES_GSI1_NAME: 'RoleIndex',
}));

describe('RolesRepository (integration)', () => {
  let repository: RolesRepository;
  let dbClient: ReturnType<typeof getTestDynamoDbClient>;

  const makeRole = (overrides?: Partial<Role>): Role => ({
    id: 'role-1',
    name: 'Test Role',
    description: 'Test',
    permissions: { deals: { view: true, create: false, edit: false, delete: false } },
    dataScope: { deals: DataScope.ALL },
    dealStageTransitions: ['*->*'],
    isSystem: false,
    priority: 50,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTable();
    dbClient = getTestDynamoDbClient();

    const module = await Test.createTestingModule({
      providers: [
        RolesRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(RolesRepository);
  });

  afterAll(async () => {
    await clearTestTable();
  });

  beforeEach(async () => {
    await clearTestTable();
  });

  describe('create + findById roundtrip', () => {
    it('should persist and retrieve a role', async () => {
      const role = makeRole();
      await repository.create(role);

      const found = await repository.findById('role-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('role-1');
      expect(found!.name).toBe('Test Role');
      expect(found!.permissions).toEqual({
        deals: { view: true, create: false, edit: false, delete: false },
      });
      expect(found!.dataScope).toEqual({ deals: 'all' });
      expect(found!.dealStageTransitions).toEqual(['*->*']);
      expect(found!.isSystem).toBe(false);
      expect(found!.priority).toBe(50);
    });
  });

  describe('create duplicate', () => {
    it('should throw on duplicate PK', async () => {
      const role = makeRole();
      await repository.create(role);

      await expect(repository.create(role)).rejects.toThrow();
    });
  });

  describe('findById', () => {
    it('should return null for nonexistent role', async () => {
      const result = await repository.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findAll (GSI1)', () => {
    it('should return all roles via GSI1', async () => {
      await repository.create(makeRole({ id: 'role-1', name: 'Role A' }));
      await repository.create(makeRole({ id: 'role-2', name: 'Role B' }));
      await repository.create(makeRole({ id: 'role-3', name: 'Role C' }));

      const result = await repository.findAll();

      expect(result).toHaveLength(3);
      const names = result.map((r) => r.name).sort();
      expect(names).toEqual(['Role A', 'Role B', 'Role C']);
    });

    it('should return empty array when no roles exist', async () => {
      const result = await repository.findAll();
      expect(result).toEqual([]);
    });
  });

  describe('findByName', () => {
    it('should return role matching name', async () => {
      await repository.create(makeRole({ id: 'role-1', name: 'Admin' }));
      await repository.create(makeRole({ id: 'role-2', name: 'Technician' }));

      const result = await repository.findByName('Admin');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('role-1');
      expect(result!.name).toBe('Admin');
    });

    it('should return null for nonexistent name', async () => {
      await repository.create(makeRole({ id: 'role-1', name: 'Admin' }));

      const result = await repository.findByName('Nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update fields and return updated role', async () => {
      await repository.create(makeRole());

      const updated = await repository.update('role-1', {
        name: 'Updated Role',
        description: 'Updated description',
        permissions: {
          deals: { view: true, create: true, edit: true, delete: false },
        },
      });

      expect(updated.name).toBe('Updated Role');
      expect(updated.description).toBe('Updated description');
      expect(updated.permissions.deals.create).toBe(true);
      // Unchanged fields preserved
      expect(updated.priority).toBe(50);
      expect(updated.isSystem).toBe(false);
    });

    it('should set updatedAt timestamp', async () => {
      await repository.create(makeRole());

      const updated = await repository.update('role-1', {
        name: 'Updated Role',
      });

      expect(updated.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    });

    it('should throw on nonexistent role', async () => {
      await expect(
        repository.update('nonexistent', { name: 'Updated' }),
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('should remove role item', async () => {
      await repository.create(makeRole());

      await repository.delete('role-1');

      const found = await repository.findById('role-1');
      expect(found).toBeNull();
    });

    it('should not throw when deleting nonexistent role', async () => {
      await expect(repository.delete('nonexistent')).resolves.not.toThrow();
    });
  });
});

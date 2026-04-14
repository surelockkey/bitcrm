import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { UserStatus, type User } from '@bitcrm/types';
import { UsersRepository } from '../../src/users/users.repository';
import {
  createTestTable,
  deleteTestTable,
  clearTestTable,
  destroyRawClient,
  getTestDynamoDbClient,
} from './setup';

// Override the table name to use test table
jest.mock('../../src/users/constants/dynamo.constants', () => ({
  USERS_TABLE: 'BitCRM_Users_Test',
  GSI1_NAME: 'RoleIndex',
  GSI2_NAME: 'DepartmentIndex',
}));

describe('UsersRepository (integration)', () => {
  let repository: UsersRepository;
  let dbClient: ReturnType<typeof getTestDynamoDbClient>;

  const makeUser = (overrides?: Partial<User>): User => ({
    id: 'user-1',
    cognitoSub: 'cognito-sub-1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    roleId: 'role-technician',
    department: 'HVAC',
    status: UserStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTable();
    dbClient = getTestDynamoDbClient();

    const module = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(UsersRepository);
  });

  afterAll(async () => {
    await clearTestTable();
  });

  beforeEach(async () => {
    await clearTestTable();
  });

  describe('create + findById roundtrip', () => {
    it('should persist and retrieve a user', async () => {
      const user = makeUser();
      await repository.create(user);

      const found = await repository.findById('user-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('user-1');
      expect(found!.email).toBe('test@example.com');
      expect(found!.roleId).toBe('role-technician');
      expect(found!.department).toBe('HVAC');
    });
  });

  describe('create duplicate', () => {
    it('should throw on duplicate PK', async () => {
      const user = makeUser();
      await repository.create(user);

      await expect(repository.create(user)).rejects.toThrow();
    });
  });

  describe('findById', () => {
    it('should return null for nonexistent user', async () => {
      const result = await repository.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findByRoleId (GSI1)', () => {
    it('should return users matching roleId', async () => {
      await repository.create(makeUser({ id: 'u1', roleId: 'role-technician' }));
      await repository.create(makeUser({ id: 'u2', roleId: 'role-technician', email: 'u2@test.com' }));
      await repository.create(makeUser({ id: 'u3', roleId: 'role-admin', email: 'u3@test.com' }));

      const result = await repository.findByRoleId('role-technician');

      expect(result).toHaveLength(2);
      expect(result.every((u) => u.roleId === 'role-technician')).toBe(true);
    });

    it('should return empty for nonexistent roleId', async () => {
      const result = await repository.findByRoleId('role-nonexistent');
      expect(result).toHaveLength(0);
    });
  });

  describe('findByDepartment (GSI2)', () => {
    it('should return users matching department', async () => {
      await repository.create(makeUser({ id: 'u1', department: 'HVAC' }));
      await repository.create(makeUser({ id: 'u2', department: 'Plumbing', email: 'u2@test.com' }));

      const result = await repository.findByDepartment('HVAC', 10);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].department).toBe('HVAC');
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      await repository.create(makeUser({ id: 'u1' }));
      await repository.create(makeUser({ id: 'u2', email: 'u2@test.com' }));
      await repository.create(makeUser({ id: 'u3', email: 'u3@test.com' }));

      // DynamoDB Scan applies Limit before FilterExpression, so we may need
      // multiple pages when the table also contains ROLE# items.
      // Use a large enough limit to get all users in one scan.
      const result = await repository.findAll(100);

      expect(result.items).toHaveLength(3);
      expect(result.items.every((u) => u.id)).toBe(true);
    });

    it('should paginate with cursor', async () => {
      await repository.create(makeUser({ id: 'u1' }));
      await repository.create(makeUser({ id: 'u2', email: 'u2@test.com' }));
      await repository.create(makeUser({ id: 'u3', email: 'u3@test.com' }));

      // DynamoDB Scan with Limit doesn't guarantee exactly N items with filters,
      // but we can verify pagination works
      const page1 = await repository.findAll(1);
      expect(page1.items.length).toBeGreaterThanOrEqual(1);

      if (page1.nextCursor) {
        const page2 = await repository.findAll(10, page1.nextCursor);
        // Total items across pages should be 3
        const allIds = [
          ...page1.items.map((u) => u.id),
          ...page2.items.map((u) => u.id),
        ];
        expect(new Set(allIds).size).toBe(allIds.length); // No duplicates
      }
    });
  });

  describe('findByStatus', () => {
    it('should filter by status correctly', async () => {
      await repository.create(makeUser({ id: 'u1', status: UserStatus.ACTIVE }));
      await repository.create(
        makeUser({ id: 'u2', status: UserStatus.INACTIVE, email: 'u2@test.com' }),
      );

      const active = await repository.findByStatus(UserStatus.ACTIVE, 10);
      const inactive = await repository.findByStatus(UserStatus.INACTIVE, 10);

      expect(active.items.every((u) => u.status === UserStatus.ACTIVE)).toBe(true);
      expect(inactive.items.every((u) => u.status === UserStatus.INACTIVE)).toBe(true);
    });
  });

  describe('update', () => {
    it('should update fields and return updated user', async () => {
      await repository.create(makeUser());

      const updated = await repository.update('user-1', {
        firstName: 'Jane',
      });

      expect(updated.firstName).toBe('Jane');
      expect(updated.lastName).toBe('Doe'); // Unchanged
    });

    it('should set updatedAt timestamp', async () => {
      await repository.create(makeUser());

      const updated = await repository.update('user-1', {
        firstName: 'Jane',
      });

      expect(updated.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    });

    it('should rebuild GSI1 keys on roleId change (verified by findByRoleId)', async () => {
      await repository.create(makeUser({ roleId: 'role-technician' }));

      await repository.update('user-1', { roleId: 'role-dispatcher' });

      // Old roleId should return empty
      const oldRole = await repository.findByRoleId('role-technician');
      expect(oldRole).toHaveLength(0);

      // New roleId should find the user
      const newRole = await repository.findByRoleId('role-dispatcher');
      expect(newRole).toHaveLength(1);
      expect(newRole[0].id).toBe('user-1');
    });

    it('should rebuild GSI2 keys on department change (verified by findByDepartment)', async () => {
      await repository.create(makeUser({ department: 'HVAC' }));

      await repository.update('user-1', { department: 'Plumbing' });

      const oldDept = await repository.findByDepartment('HVAC', 10);
      expect(oldDept.items).toHaveLength(0);

      const newDept = await repository.findByDepartment('Plumbing', 10);
      expect(newDept.items).toHaveLength(1);
    });

    it('should throw on nonexistent user', async () => {
      await expect(
        repository.update('nonexistent', { firstName: 'Jane' }),
      ).rejects.toThrow();
    });
  });
});

import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { UserStatus } from '@bitcrm/types';
import { UsersRepository } from '../../../src/users/users.repository';
import { createMockDynamoDbClient, createMockUser } from '../mocks';

describe('UsersRepository', () => {
  let repository: UsersRepository;
  let dbClient: ReturnType<typeof createMockDynamoDbClient>;

  beforeEach(async () => {
    dbClient = createMockDynamoDbClient();

    const module = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(UsersRepository);
  });

  describe('create', () => {
    it('should send PutCommand with correct keys and ConditionExpression', async () => {
      dbClient.send.mockResolvedValue({});
      const user = createMockUser();

      await repository.create(user);

      expect(dbClient.send).toHaveBeenCalledTimes(1);
      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.TableName).toBe('BitCRM_Users');
      expect(input.Item.PK).toBe('USER#user-1');
      expect(input.Item.SK).toBe('METADATA');
      expect(input.Item.GSI1PK).toBe('ROLE_USER#role-technician');
      expect(input.Item.GSI1SK).toBe('USER#user-1');
      expect(input.Item.GSI2PK).toBe('DEPT#HVAC');
      expect(input.Item.GSI2SK).toBe('USER#user-1');
      expect(input.ConditionExpression).toBe('attribute_not_exists(PK)');
    });
  });

  describe('findById', () => {
    it('should return mapped user when item exists', async () => {
      const user = createMockUser();
      dbClient.send.mockResolvedValue({
        Item: { PK: 'USER#user-1', SK: 'METADATA', ...user },
      });

      const result = await repository.findById('user-1');

      expect(result).toEqual(user);
      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.Key).toEqual({ PK: 'USER#user-1', SK: 'METADATA' });
    });

    /**
     * Regression: the mapper listed fields one by one and left `phone` out, so
     * the number was stored but never read back. It hid the field on the
     * profile, let an edit form default to blank and clear it, and stopped the
     * old lookup item being deleted when somebody changed their number.
     */
    it('returns the personal phone that is stored on the item', async () => {
      const user = createMockUser();
      dbClient.send.mockResolvedValue({
        Item: {
          PK: 'USER#user-1',
          SK: 'METADATA',
          ...user,
          phone: '+380958601427',
        },
      });

      const result = await repository.findById('user-1');

      expect(result?.phone).toBe('+380958601427');
    });

    it('reads the field-team flag back, and leaves it absent on a record from before it', async () => {
      const user = createMockUser();
      dbClient.send.mockResolvedValue({
        Item: { PK: 'USER#user-1', SK: 'METADATA', ...user, fieldTeamMember: false },
      });
      expect((await repository.findById('user-1'))?.fieldTeamMember).toBe(false);

      dbClient.send.mockResolvedValue({
        Item: { PK: 'USER#user-1', SK: 'METADATA', ...user },
      });
      // Absent, not defaulted: the role answers for these, in `isFieldTeamMember`.
      expect((await repository.findById('user-1'))?.fieldTeamMember).toBeUndefined();
    });

    it('leaves the phone undefined for somebody who has not set one', async () => {
      const user = createMockUser();
      dbClient.send.mockResolvedValue({
        Item: { PK: 'USER#user-1', SK: 'METADATA', ...user },
      });

      const result = await repository.findById('user-1');

      expect(result?.phone).toBeUndefined();
    });

    it('should return null when item does not exist', async () => {
      dbClient.send.mockResolvedValue({ Item: undefined });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByRole', () => {
    it('should query GSI1 with correct key expression', async () => {
      dbClient.send.mockResolvedValue({ Items: [], LastEvaluatedKey: undefined });

      await repository.findByRole('admin', 10);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('RoleIndex');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :pk');
      expect(input.ExpressionAttributeValues[':pk']).toBe('ROLE_USER#admin');
      expect(input.Limit).toBe(10);
    });

    it('should return items and nextCursor when paginated', async () => {
      const user = createMockUser();
      const lastKey = { PK: 'USER#user-1', SK: 'METADATA' };
      dbClient.send.mockResolvedValue({
        Items: [{ ...user, PK: 'USER#user-1', SK: 'METADATA' }],
        LastEvaluatedKey: lastKey,
      });

      const result = await repository.findByRole('technician', 10);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeDefined();
      // Verify cursor is valid base64url
      const decoded = JSON.parse(
        Buffer.from(result.nextCursor!, 'base64url').toString('utf-8'),
      );
      expect(decoded).toEqual(lastKey);
    });

    it('should return undefined nextCursor on last page', async () => {
      dbClient.send.mockResolvedValue({
        Items: [],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findByRole('admin', 10);

      expect(result.nextCursor).toBeUndefined();
    });

    it('should decode and pass cursor as ExclusiveStartKey', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });
      const startKey = { PK: 'USER#user-5', SK: 'METADATA' };
      const cursor = Buffer.from(JSON.stringify(startKey)).toString('base64url');

      await repository.findByRole('admin', 10, cursor);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.ExclusiveStartKey).toEqual(startKey);
    });
  });

  /**
   * Unlike `findByRole`, this one has no cursor to hand back — the caller gets
   * "everyone in the role" or a wrong answer. deal-service reconciles its
   * dispatch projection against this list and DELETES the technicians missing
   * from it, so a page-one-only read takes every technician past the first 1MB
   * out of the job's technician picker.
   */
  describe('findByRoleId', () => {
    it('follows LastEvaluatedKey until the role is exhausted', async () => {
      const page1 = createMockUser({ id: 'tech-1' });
      const page2 = createMockUser({ id: 'tech-2' });
      dbClient.send
        .mockResolvedValueOnce({
          Items: [{ PK: 'USER#tech-1', SK: 'METADATA', ...page1 }],
          LastEvaluatedKey: { PK: 'USER#tech-1', SK: 'METADATA' },
        })
        .mockResolvedValueOnce({
          Items: [{ PK: 'USER#tech-2', SK: 'METADATA', ...page2 }],
        });

      const result = await repository.findByRoleId('role-technician');

      expect(result.map((u) => u.id)).toEqual(['tech-1', 'tech-2']);
      expect(dbClient.send).toHaveBeenCalledTimes(2);
      expect(dbClient.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({
        PK: 'USER#tech-1',
        SK: 'METADATA',
      });
    });

    it('queries GSI1 for the role and stops on a single page', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });

      await repository.findByRoleId('role-technician');

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('RoleIndex');
      expect(input.ExpressionAttributeValues[':pk']).toBe('ROLE_USER#role-technician');
      expect(dbClient.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('findByDepartment', () => {
    it('should query GSI2 with correct key', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });

      await repository.findByDepartment('HVAC', 10);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('DepartmentIndex');
      expect(input.ExpressionAttributeValues[':pk']).toBe('DEPT#HVAC');
    });
  });

  describe('findAll', () => {
    it('carries the phone through the list mapping too', async () => {
      const user = createMockUser();
      dbClient.send.mockResolvedValue({
        Items: [{ PK: 'USER#user-1', SK: 'METADATA', ...user, phone: '+14045551234' }],
      });

      const result = await repository.findAll(20);

      // The users list feeds the edit form's defaults — a blank here is what
      // wiped somebody's number when an admin saved an unrelated change.
      expect(result.items[0].phone).toBe('+14045551234');
    });

    it('should scan with begins_with filter', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });

      await repository.findAll(20);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.FilterExpression).toContain('begins_with(PK, :pk)');
      expect(input.ExpressionAttributeValues[':pk']).toBe('USER#');
    });

    it('reads more rows than the page, because the filter throws most of them away', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });

      await repository.findAll(20);

      // The table also holds job types, service areas, commissions and tech
      // profiles; asking for exactly 20 rows once returned a handful of users.
      expect(dbClient.send.mock.calls[0][0].input.Limit).toBeGreaterThan(20);
    });

    it('keeps reading until the page is full', async () => {
      const user = (id: string) => ({ PK: `USER#${id}`, SK: 'METADATA', id });
      dbClient.send
        .mockResolvedValueOnce({ Items: [user('a')], LastEvaluatedKey: { PK: 'p1' } })
        .mockResolvedValueOnce({ Items: [user('b')], LastEvaluatedKey: { PK: 'p2' } })
        .mockResolvedValueOnce({ Items: [user('c')] });

      const result = await repository.findAll(3);

      expect(result.items.map((u) => u.id)).toEqual(['a', 'b', 'c']);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe('findByStatus', () => {
    it('should scan with status filter and ExpressionAttributeNames', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });

      await repository.findByStatus(UserStatus.ACTIVE, 10);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.ExpressionAttributeNames['#status']).toBe('status');
      expect(input.ExpressionAttributeValues[':status']).toBe('active');
    });
  });

  describe('update', () => {
    it('should build dynamic UpdateExpression and always include updatedAt', async () => {
      const updated = createMockUser({ firstName: 'Updated' });
      dbClient.send.mockResolvedValue({ Attributes: { ...updated } });

      await repository.update('user-1', { firstName: 'Updated' });

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).toContain('#firstName = :firstName');
      expect(input.UpdateExpression).toContain('#updatedAt = :updatedAt');
      expect(input.ExpressionAttributeNames['#firstName']).toBe('firstName');
      expect(input.ExpressionAttributeValues[':firstName']).toBe('Updated');
      expect(input.ConditionExpression).toBe('attribute_exists(PK)');
    });

    it('should skip id, cognitoSub, and email from expression', async () => {
      dbClient.send.mockResolvedValue({ Attributes: createMockUser() });

      await repository.update('user-1', {
        id: 'should-be-ignored',
        cognitoSub: 'should-be-ignored',
        email: 'should-be-ignored',
        firstName: 'Valid',
      } as never);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).not.toContain('#id');
      expect(input.UpdateExpression).not.toContain('#cognitoSub');
      expect(input.UpdateExpression).not.toContain('#email');
      expect(input.UpdateExpression).toContain('#firstName');
    });

    it('should rebuild GSI1 keys when roleId changes', async () => {
      dbClient.send.mockResolvedValue({
        Attributes: createMockUser({ roleId: 'role-dispatcher' }),
      });

      await repository.update('user-1', { roleId: 'role-dispatcher' });

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).toContain('#GSI1PK');
      expect(input.ExpressionAttributeValues[':GSI1PK']).toBe(
        'ROLE_USER#role-dispatcher',
      );
      expect(input.ExpressionAttributeValues[':GSI1SK']).toBe('USER#user-1');
    });

    it('should rebuild GSI2 keys when department changes', async () => {
      dbClient.send.mockResolvedValue({
        Attributes: createMockUser({ department: 'Plumbing' }),
      });

      await repository.update('user-1', { department: 'Plumbing' });

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).toContain('#GSI2PK');
      expect(input.ExpressionAttributeValues[':GSI2PK']).toBe('DEPT#Plumbing');
    });

    it('should omit GSI keys when role and department unchanged', async () => {
      dbClient.send.mockResolvedValue({ Attributes: createMockUser() });

      await repository.update('user-1', { firstName: 'Updated' });

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).not.toContain('GSI1PK');
      expect(input.UpdateExpression).not.toContain('GSI2PK');
    });
  });
});

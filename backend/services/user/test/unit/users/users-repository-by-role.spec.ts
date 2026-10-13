import { UsersRepository } from '../../../src/users/users.repository';
import { createMockDynamoDbClient } from '../mocks';

/**
 * `GET /roles/:id/users` (and the role-cache invalidation) read every member of
 * a role. The read is projected to exactly the attributes `toUser` returns — so
 * the response is the same `User[]`, without the GSI keys and whatever else a
 * user row carries.
 */
describe('UsersRepository.findByRoleId', () => {
  it('projects the user list columns and keeps the User shape', async () => {
    const client = createMockDynamoDbClient();
    const repo = new UsersRepository({ client } as never);
    const row = {
      id: 'u-1',
      cognitoSub: 'sub',
      email: 'a@x.com',
      firstName: 'A',
      lastName: 'B',
      roleId: 'role-1',
      department: 'HQ',
      phone: '+15550001111',
      status: 'active',
      createdAt: 't0',
      updatedAt: 't1',
    };
    client.send
      .mockResolvedValueOnce({ Items: [row], LastEvaluatedKey: { PK: 'k' } })
      .mockResolvedValueOnce({ Items: [{ ...row, id: 'u-2' }] });

    const users = await repo.findByRoleId('role-1');

    expect(users.map((u) => u.id)).toEqual(['u-1', 'u-2']);
    expect(users[0]).toMatchObject({ email: 'a@x.com', phone: '+15550001111', status: 'active' });

    const input = client.send.mock.calls[0][0].input;
    expect(input.ExpressionAttributeValues[':pk']).toBe('ROLE_USER#role-1');
    const projected = (input.ProjectionExpression as string)
      .split(',')
      .map((n: string) => input.ExpressionAttributeNames[n.trim()])
      .sort();
    expect(projected).toEqual(
      [
        'cognitoSub', 'createdAt', 'department', 'email', 'fieldTeamMember', 'firstName', 'id',
        'lastName', 'permissionOverrides', 'phone', 'roleId', 'smsMfaEnabled', 'status',
        'updatedAt', 'userType', 'workizName',
      ].sort(),
    );
    expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ PK: 'k' });
  });
});

import { cognitoClaimsFor } from '../../../src/users/cognito-claims.util';

describe('cognitoClaimsFor', () => {
  it('maps the authoritative DynamoDB identity to Cognito custom attributes', () => {
    const claims = cognitoClaimsFor({
      id: 'c1bf38e3',
      roleId: 'role-super-admin',
      department: 'Engineering',
    });
    expect(claims).toEqual([
      { Name: 'custom:user_id', Value: 'c1bf38e3' },
      { Name: 'custom:role_id', Value: 'role-super-admin' },
      { Name: 'custom:department', Value: 'Engineering' },
    ]);
  });

  it('omits attributes whose source value is missing/empty', () => {
    const claims = cognitoClaimsFor({ id: 'u1', roleId: '', department: undefined });
    expect(claims).toEqual([{ Name: 'custom:user_id', Value: 'u1' }]);
  });
});

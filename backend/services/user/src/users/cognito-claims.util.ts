/**
 * The DynamoDB user record is the source of truth for identity. The Cognito
 * token must mirror it via custom claims — the auth guard reads
 * `custom:user_id` as the caller id and `custom:role_id` for permission
 * resolution. New users get these set on creation; this helper is also used to
 * backfill legacy users whose claims drifted (e.g. custom:user_id == sub).
 */
export interface CognitoClaimSource {
  id: string;
  roleId?: string;
  department?: string;
}

export interface CognitoAttribute {
  Name: string;
  Value: string;
}

export function cognitoClaimsFor(user: CognitoClaimSource): CognitoAttribute[] {
  const pairs: Array<[string, string | undefined]> = [
    ['custom:user_id', user.id],
    ['custom:role_id', user.roleId],
    ['custom:department', user.department],
  ];
  return pairs
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([Name, value]) => ({ Name, Value: value as string }));
}

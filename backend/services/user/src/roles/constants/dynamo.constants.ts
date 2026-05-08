export const ROLES_TABLE = process.env.USERS_TABLE || process.env.DYNAMODB_TABLE || 'BitCRM_Users';
export const ROLES_GSI1_NAME = 'RoleIndex';

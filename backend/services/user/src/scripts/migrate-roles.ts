/**
 * Migration script: Maps existing UserRole enum values to seeded role IDs.
 *
 * Usage:
 *   ts-node src/scripts/migrate-roles.ts           # Execute migration
 *   ts-node src/scripts/migrate-roles.ts --dry-run  # Preview changes only
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import {
  DynamoDBClient,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const USERS_TABLE = 'BitCRM_Users';
const DRY_RUN = process.argv.includes('--dry-run');

// Map old role enum → new seeded roleId
const ROLE_MAP: Record<string, string> = {
  super_admin: 'role-super-admin',
  admin: 'role-admin',
  dept_manager: 'role-dept-manager',
  dispatcher: 'role-dispatcher',
  technician: 'role-technician',
};

// Default role definitions for seeding
const DEFAULT_ROLES = [
  {
    id: 'role-super-admin',
    name: 'Super Admin',
    description: 'Full system access',
    isSystem: true,
    priority: 100,
  },
  {
    id: 'role-admin',
    name: 'Admin',
    description: 'Full CRM access, user management',
    isSystem: true,
    priority: 80,
  },
  {
    id: 'role-dept-manager',
    name: 'Department Manager',
    description: 'Department-scoped access',
    isSystem: true,
    priority: 60,
  },
  {
    id: 'role-dispatcher',
    name: 'Dispatcher',
    description: 'Deals and contacts CRUD',
    isSystem: true,
    priority: 40,
  },
  {
    id: 'role-technician',
    name: 'Technician',
    description: 'Assigned-only scope, minimal permissions',
    isSystem: true,
    priority: 20,
  },
];

async function main() {
  const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });

  const docClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true },
  });

  const cognitoClient = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  const userPoolId = process.env.COGNITO_USER_POOL_ID;

  console.log(`Migration mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  // Step 1: Seed default roles
  console.log('=== Step 1: Seed default roles ===');
  const now = new Date().toISOString();
  for (const role of DEFAULT_ROLES) {
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would seed role: ${role.name} (${role.id})`);
      continue;
    }

    try {
      await docClient.send(
        new PutCommand({
          TableName: USERS_TABLE,
          Item: {
            PK: `ROLE#${role.id}`,
            SK: 'METADATA',
            GSI1PK: 'ROLE_ENTITY',
            GSI1SK: `ROLE#${role.id}`,
            ...role,
            permissions: {},
            dataScope: {},
            dealStageTransitions: role.id === 'role-super-admin' ? ['*->*'] : [],
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      console.log(`  Seeded role: ${role.name} (${role.id})`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        console.log(`  Role already exists: ${role.name} (${role.id})`);
      } else {
        throw error;
      }
    }
  }

  // Step 2: Scan all users and migrate
  console.log('');
  console.log('=== Step 2: Migrate users ===');

  let lastKey: Record<string, any> | undefined;
  let migratedCount = 0;
  let skippedCount = 0;

  do {
    const scanResult = await dynamoClient.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
        ExpressionAttributeValues: {
          ':pk': { S: 'USER#' },
          ':sk': { S: 'METADATA' },
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of scanResult.Items || []) {
      const userId = item.id?.S;
      const oldRole = item.role?.S;
      const cognitoSub = item.cognitoSub?.S;
      const existingRoleId = item.roleId?.S;

      if (!userId || !oldRole) continue;

      // Skip if already migrated
      if (existingRoleId) {
        console.log(`  Skipping ${userId} (already has roleId: ${existingRoleId})`);
        skippedCount++;
        continue;
      }

      const newRoleId = ROLE_MAP[oldRole];
      if (!newRoleId) {
        console.log(`  WARNING: Unknown role "${oldRole}" for user ${userId}`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would migrate ${userId}: ${oldRole} → ${newRoleId}`);
        migratedCount++;
        continue;
      }

      // Update DynamoDB: set roleId, update GSI1PK
      await docClient.send(
        new UpdateCommand({
          TableName: USERS_TABLE,
          Key: { PK: `USER#${userId}`, SK: 'METADATA' },
          UpdateExpression: 'SET #roleId = :roleId, #gsi1pk = :gsi1pk, #gsi1sk = :gsi1sk, #overrides = :overrides, #updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#roleId': 'roleId',
            '#gsi1pk': 'GSI1PK',
            '#gsi1sk': 'GSI1SK',
            '#overrides': 'permissionOverrides',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':roleId': newRoleId,
            ':gsi1pk': `ROLE_USER#${newRoleId}`,
            ':gsi1sk': `USER#${userId}`,
            ':overrides': {},
            ':updatedAt': now,
          },
        }),
      );

      // Update Cognito
      if (cognitoSub && userPoolId) {
        try {
          await cognitoClient.send(
            new AdminUpdateUserAttributesCommand({
              UserPoolId: userPoolId,
              Username: cognitoSub,
              UserAttributes: [
                { Name: 'custom:role_id', Value: newRoleId },
              ],
            }),
          );
        } catch (error) {
          console.log(`  WARNING: Failed to update Cognito for ${userId}: ${error}`);
        }
      }

      console.log(`  Migrated ${userId}: ${oldRole} → ${newRoleId}`);
      migratedCount++;
    }

    lastKey = scanResult.LastEvaluatedKey;
  } while (lastKey);

  console.log('');
  console.log(`=== Migration complete ===`);
  console.log(`  Migrated: ${migratedCount}`);
  console.log(`  Skipped: ${skippedCount}`);
  if (DRY_RUN) {
    console.log('  (No changes were made — dry run mode)');
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

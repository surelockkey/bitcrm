import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env for COGNITO_USER_POOL_ID, DYNAMODB_ENDPOINT etc.
// but remove local AWS credentials so Cognito uses real ones from ~/.aws
config({ path: resolve(__dirname, '../../../../.env') });
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;

import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const USERS_TABLE = 'BitCRM_Users';

const SEED_USER = {
  email: process.argv[2] || 'admin@bitcrm.local',
  password: process.argv[3] || 'Admin123!',
  firstName: 'Admin',
  lastName: 'User',
  role: 'super_admin',
  department: 'Engineering',
};

async function main() {
  let id: string = randomUUID();
  const now = new Date().toISOString();

  console.log(`\nSeeding super_admin user: ${SEED_USER.email}\n`);

  // 1. Create Cognito user
  const cognitoClient = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    throw new Error('COGNITO_USER_POOL_ID is not set in .env');
  }

  let cognitoSub: string;
  try {
    const result = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: SEED_USER.email,
        UserAttributes: [
          { Name: 'email', Value: SEED_USER.email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:role', Value: SEED_USER.role },
          { Name: 'custom:department', Value: SEED_USER.department },
          { Name: 'custom:user_id', Value: id },
        ],
        MessageAction: 'SUPPRESS', // Don't send email, we'll set password directly
      }),
    );

    cognitoSub = result.User?.Attributes?.find(
      (a) => a.Name === 'sub',
    )?.Value as string;

    console.log(`  Cognito user created (sub: ${cognitoSub})`);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === 'UsernameExistsException'
    ) {
      console.log('  Cognito user already exists, looking up sub...');
      const existing = await cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: userPoolId,
          Username: SEED_USER.email,
        }),
      );
      cognitoSub = existing.UserAttributes?.find(
        (a) => a.Name === 'sub',
      )?.Value as string;
      const existingId = existing.UserAttributes?.find(
        (a) => a.Name === 'custom:user_id',
      )?.Value;
      if (existingId) id = existingId;
      console.log(`  Found existing user (sub: ${cognitoSub}, id: ${id})`);
    } else {
      throw error;
    }
  }

  // 2. Set permanent password (skip the temp password flow)
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: SEED_USER.email,
      Password: SEED_USER.password,
      Permanent: true,
    }),
  );
  console.log(`  Password set permanently`);

  // 3. Create DynamoDB record (always use local endpoint for seed)
  const dynamoEndpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
  console.log(`  Connecting to DynamoDB at ${dynamoEndpoint}...`);
  const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: dynamoEndpoint,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const docClient = DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: { removeUndefinedValues: true },
  });

  console.log(`  Writing to table ${USERS_TABLE}...`);
  await docClient.send(
    new PutCommand({
      TableName: USERS_TABLE,
      Item: {
        PK: `USER#${id}`,
        SK: 'METADATA',
        id,
        cognitoSub,
        email: SEED_USER.email,
        firstName: SEED_USER.firstName,
        lastName: SEED_USER.lastName,
        role: SEED_USER.role,
        department: SEED_USER.department,
        status: 'active',
        GSI1PK: `ROLE#${SEED_USER.role}`,
        GSI1SK: `USER#${id}`,
        GSI2PK: `DEPT#${SEED_USER.department}`,
        GSI2SK: `USER#${id}`,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  console.log(`  DynamoDB record created (id: ${id})`);

  console.log(`\nDone! You can now login:`);
  console.log(`  Email:    ${SEED_USER.email}`);
  console.log(`  Password: ${SEED_USER.password}`);
  console.log(`  Role:     super_admin\n`);

  ddbClient.destroy();
  cognitoClient.destroy();
}

main().catch((err) => {
  console.error('Seed failed:', err.message || err);
  process.exit(1);
});

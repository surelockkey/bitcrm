import {
  CanActivate,
  ExecutionContext,
  Global,
  INestApplication,
  Injectable,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  CognitoAdminService,
  DynamoDbModule,
  RedisModule,
  CognitoAdminModule,
  PermissionGuard,
  PermissionCacheReader,
  HttpExceptionFilter,
} from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { UsersModule } from '../../src/users/users.module';
import { RolesModule } from '../../src/roles/roles.module';
import {
  createTestTable,
  deleteTestTable,
  clearTestTable,
  destroyRawClient,
  getTestRedisClient,
} from '../integration/setup';
import type Redis from 'ioredis';

// Test auth guard: reads x-test-user header instead of Cognito JWT
@Injectable()
class TestAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const userHeader = request.headers['x-test-user'];
    if (!userHeader) {
      throw new UnauthorizedException();
    }

    request.user = JSON.parse(userHeader as string);
    return true;
  }
}

// Global module that provides PermissionCacheReader to all modules
@Global()
@Module({
  providers: [PermissionCacheReader],
  exports: [PermissionCacheReader],
})
class TestPermissionModule {}

export function createTestUserHeader(user: JwtUser): string {
  return JSON.stringify(user);
}

// Mock CognitoAdminService
const mockCognitoAdmin = {
  createUser: jest.fn().mockResolvedValue({
    User: {
      Attributes: [{ Name: 'sub', Value: 'cognito-sub-test' }],
    },
  }),
  updateUserAttributes: jest.fn().mockResolvedValue(undefined),
  disableUser: jest.fn().mockResolvedValue(undefined),
  enableUser: jest.fn().mockResolvedValue(undefined),
  deleteUser: jest.fn().mockResolvedValue(undefined),
};

export function getMockCognitoAdmin() {
  return mockCognitoAdmin;
}

/**
 * Seed a custom role's permissions into Redis so the PermissionGuard can resolve them.
 * Call this after creating a custom role via the API.
 */
export async function seedRolePermissionsInRedis(roleId: string): Promise<void> {
  if (!app || !redis) return;
  const { RolesService } = await import('../../src/roles/roles.service');
  const { PermissionResolverService } = await import('../../src/roles/permission-resolver.service');
  const rolesService = app.get(RolesService);
  const resolver = app.get(PermissionResolverService);
  const role = await rolesService.findById(roleId);
  const resolved = resolver.resolve(role);
  await redis.set(`role:permissions:${role.id}`, JSON.stringify(resolved), 'EX', 3600);
}

let app: INestApplication;
let redis: Redis;

export async function setupApp(): Promise<INestApplication> {
  process.env.DYNAMODB_ENDPOINT = 'http://localhost:8001';
  process.env.AWS_REGION = 'us-east-1';
  process.env.REDIS_URL = 'redis://localhost:6379';

  const moduleRef = await Test.createTestingModule({
    imports: [DynamoDbModule, RedisModule, CognitoAdminModule, TestPermissionModule, RolesModule, UsersModule],
    providers: [
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_GUARD, useClass: PermissionGuard },
    ],
  })
    .overrideProvider(CognitoAdminService)
    .useValue(mockCognitoAdmin)
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/users');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  await createTestTable();
  redis = getTestRedisClient();
  await app.init();

  // Seed role permissions into Redis so the PermissionGuard can resolve them
  // without needing a user record in DynamoDB
  const { RolesService } = await import('../../src/roles/roles.service');
  const rolesService = moduleRef.get(RolesService);
  const { PermissionResolverService } = await import('../../src/roles/permission-resolver.service');
  const resolver = moduleRef.get(PermissionResolverService);
  const roles = await rolesService.findAll();
  for (const role of roles) {
    const resolved = resolver.resolve(role);
    await redis.set(
      `user:permissions:${role.id}`,
      JSON.stringify(resolved),
      'EX',
      3600,
    );
    await redis.set(
      `role:permissions:${role.id}`,
      JSON.stringify(resolved),
      'EX',
      3600,
    );
  }

  return app;
}

export async function teardownApp(): Promise<void> {
  await clearTestTable();
  if (redis) await redis.quit();
  if (app) await app.close();
}

export async function cleanupData(): Promise<void> {
  // Clear user items and custom (non-system) role items
  await clearUserItems();
  await clearCustomRoleItems();
  if (redis) await redis.flushdb();
  Object.values(mockCognitoAdmin).forEach((fn) => fn.mockClear());

  // Re-populate role permission cache after Redis flush
  if (app) {
    const { RolesService } = await import('../../src/roles/roles.service');
    const { PermissionResolverService } = await import('../../src/roles/permission-resolver.service');
    const rolesService = app.get(RolesService);
    const resolver = app.get(PermissionResolverService);
    const roles = await rolesService.findAll();
    for (const role of roles) {
      const resolved = resolver.resolve(role);
      await redis.set(`role:permissions:${role.id}`, JSON.stringify(resolved), 'EX', 3600);
    }
  }
}

const SYSTEM_ROLE_IDS = new Set([
  'role-super-admin',
  'role-admin',
  'role-dispatcher',
  'role-technician',
  'role-read-only',
]);

/** Clear custom (non-system) ROLE# items from the test table */
async function clearCustomRoleItems(): Promise<void> {
  const { ScanCommand, DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const client = new DynamoDBClient({
    region: 'us-east-1',
    endpoint: 'http://localhost:8001',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const result = await client.send(new ScanCommand({
    TableName: 'BitCRM_Users_Test',
    FilterExpression: 'begins_with(PK, :prefix)',
    ExpressionAttributeValues: { ':prefix': { S: 'ROLE#' } },
  }));
  if (result.Items) {
    for (const item of result.Items) {
      const pk = item.PK?.S || '';
      const roleId = pk.replace('ROLE#', '');
      if (!SYSTEM_ROLE_IDS.has(roleId)) {
        await client.send(new DeleteItemCommand({
          TableName: 'BitCRM_Users_Test',
          Key: { PK: item.PK!, SK: item.SK! },
        }));
      }
    }
  }
  client.destroy();
}

/** Clear only USER# items from the test table, keeping ROLE# items */
async function clearUserItems(): Promise<void> {
  const { ScanCommand, DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const client = new DynamoDBClient({
    region: 'us-east-1',
    endpoint: 'http://localhost:8001',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const result = await client.send(new ScanCommand({
    TableName: 'BitCRM_Users_Test',
    FilterExpression: 'begins_with(PK, :prefix)',
    ExpressionAttributeValues: { ':prefix': { S: 'USER#' } },
  }));
  if (result.Items) {
    for (const item of result.Items) {
      await client.send(new DeleteItemCommand({
        TableName: 'BitCRM_Users_Test',
        Key: { PK: item.PK!, SK: item.SK! },
      }));
    }
  }
  client.destroy();
}

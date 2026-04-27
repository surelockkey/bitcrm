jest.mock('../../src/common/constants/dynamo.constants', () => ({
  CONTACTS_TABLE: 'BitCRM_Contacts_Test',
  COMPANIES_TABLE: 'BitCRM_Companies_Test',
  CONTACTS_GSI1_NAME: 'CompanyIndex',
  COMPANIES_GSI1_NAME: 'ClientTypeIndex',
}));

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
  DynamoDbModule,
  RedisModule,
  PermissionGuard,
  PermissionCacheReader,
  HttpExceptionFilter,
} from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ContactsModule } from 'src/contacts/contacts.module';
import { CompaniesModule } from 'src/companies/companies.module';
import {
  createTestTables,
  clearTestTable,
  destroyRawClient,
  CONTACTS_TEST_TABLE,
  COMPANIES_TEST_TABLE,
} from '../integration/setup';
import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
process.env.DYNAMODB_ENDPOINT = 'http://localhost:8001';
process.env.AWS_REGION = 'us-east-1';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.INTERNAL_SERVICE_SECRET = 'test-secret';

// ---------------------------------------------------------------------------
// Test auth guard: reads x-test-user header instead of Cognito JWT
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Global module that provides PermissionCacheReader to all modules
// ---------------------------------------------------------------------------
@Global()
@Module({
  providers: [PermissionCacheReader],
  exports: [PermissionCacheReader],
})
class TestPermissionModule {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function createTestUserHeader(user: JwtUser): string {
  return JSON.stringify(user);
}

// ---------------------------------------------------------------------------
// Permission seeds for CRM resources
// ---------------------------------------------------------------------------
const superAdminPermissions = {
  permissions: {
    contacts: { view: true, create: true, edit: true, delete: true },
    companies: { view: true, create: true, edit: true, delete: true },
  },
  dataScope: { contacts: 'all', companies: 'all' },
};

const adminPermissions = {
  permissions: {
    contacts: { view: true, create: true, edit: true, delete: true },
    companies: { view: true, create: true, edit: true, delete: false },
  },
  dataScope: { contacts: 'all', companies: 'all' },
};

const dispatcherPermissions = {
  permissions: {
    contacts: { view: true, create: true, edit: true, delete: false },
    companies: { view: true, create: false, edit: false, delete: false },
  },
  dataScope: { contacts: 'all', companies: 'all' },
};

const techPermissions = {
  permissions: {
    contacts: { view: true, create: false, edit: false, delete: false },
    companies: { view: true, create: false, edit: false, delete: false },
  },
  dataScope: { contacts: 'assigned_only', companies: 'all' },
};

const readOnlyPermissions = {
  permissions: {
    contacts: { view: true, create: false, edit: false, delete: false },
    companies: { view: true, create: false, edit: false, delete: false },
  },
  dataScope: { contacts: 'all', companies: 'all' },
};

async function seedPermissions(redis: Redis): Promise<void> {
  await redis.set('role:permissions:role-super-admin', JSON.stringify(superAdminPermissions), 'EX', 3600);
  await redis.set('role:permissions:role-admin', JSON.stringify(adminPermissions), 'EX', 3600);
  await redis.set('role:permissions:role-dispatcher', JSON.stringify(dispatcherPermissions), 'EX', 3600);
  await redis.set('role:permissions:role-technician', JSON.stringify(techPermissions), 'EX', 3600);
  await redis.set('role:permissions:role-read-only', JSON.stringify(readOnlyPermissions), 'EX', 3600);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
let app: INestApplication;
let redis: Redis;

export async function setupApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      DynamoDbModule,
      RedisModule,
      TestPermissionModule,
      ContactsModule,
      CompaniesModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_GUARD, useClass: PermissionGuard },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/crm');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  await createTestTables();
  redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 3 });
  await seedPermissions(redis);
  await app.init();

  return app;
}

export async function teardownApp(): Promise<void> {
  await clearTestTable(CONTACTS_TEST_TABLE);
  await clearTestTable(COMPANIES_TEST_TABLE);
  if (redis) await redis.quit();
  if (app) await app.close();
  destroyRawClient();
}

export async function cleanupData(): Promise<void> {
  await clearTestTable(CONTACTS_TEST_TABLE);
  await clearTestTable(COMPANIES_TEST_TABLE);
  if (redis) await redis.flushdb();
  await seedPermissions(redis);
}

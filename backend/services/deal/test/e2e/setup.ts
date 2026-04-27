jest.mock('../../src/common/constants/dynamo.constants', () => ({
  DEALS_TABLE: 'BitCRM_Deals_Test',
  DEALS_GSI1_NAME: 'StageIndex',
  DEALS_GSI2_NAME: 'TechIndex',
  DEALS_GSI3_NAME: 'ContactIndex',
  DEALS_GSI4_NAME: 'DispatcherIndex',
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
import { DealsModule } from 'src/deals/deals.module';
import { InternalHttpService } from 'src/common/services/internal-http.service';
import {
  createTestTables,
  clearTestTable,
  destroyRawClient,
  DEALS_TEST_TABLE,
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
// Mock InternalHttpService (no real CRM/inventory calls)
// ---------------------------------------------------------------------------
const mockInternalHttpService = {
  validateContact: jest.fn().mockResolvedValue(true),
  getTechnicians: jest.fn().mockResolvedValue([]),
  deductStock: jest.fn().mockResolvedValue(undefined),
  restoreStock: jest.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function createTestUserHeader(user: JwtUser): string {
  return JSON.stringify(user);
}

export function getInternalHttpMock() {
  return mockInternalHttpService;
}

// ---------------------------------------------------------------------------
// Permission seeds for deals resource
// ---------------------------------------------------------------------------
const superAdminPermissions = {
  permissions: {
    deals: { view: true, create: true, edit: true, delete: true },
  },
  dataScope: { deals: 'all' },
  dealStageTransitions: ['*->*'],
};

const adminPermissions = {
  permissions: {
    deals: { view: true, create: true, edit: true, delete: true },
  },
  dataScope: { deals: 'all' },
  dealStageTransitions: ['*->*'],
};

const dispatcherPermissions = {
  permissions: {
    deals: { view: true, create: true, edit: true, delete: false },
  },
  dataScope: { deals: 'department' },
  dealStageTransitions: [
    'new_lead->estimate_sent', 'estimate_sent->approved', 'approved->assigned',
    'new_lead->assigned', '*->canceled', '*->follow_up', '*->on_hold',
  ],
};

const techPermissions = {
  permissions: {
    deals: { view: true, create: false, edit: true, delete: false },
  },
  dataScope: { deals: 'assigned_only' },
  dealStageTransitions: [
    'assigned->en_route', 'en_route->on_site', 'on_site->work_in_progress',
    'work_in_progress->pending_payment', 'work_in_progress->pending_parts',
  ],
};

const readOnlyPermissions = {
  permissions: {
    deals: { view: true, create: false, edit: false, delete: false },
  },
  dataScope: { deals: 'all' },
  dealStageTransitions: [],
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
      DealsModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_GUARD, useClass: PermissionGuard },
    ],
  })
    .overrideProvider(InternalHttpService)
    .useValue(mockInternalHttpService)
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/deals');
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
  await clearTestTable(DEALS_TEST_TABLE);
  if (redis) await redis.quit();
  if (app) await app.close();
  destroyRawClient();
}

export async function cleanupData(): Promise<void> {
  await clearTestTable(DEALS_TEST_TABLE);
  if (redis) await redis.flushdb();
  await seedPermissions(redis);
}

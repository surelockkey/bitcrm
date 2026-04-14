jest.mock('../../src/common/constants/dynamo.constants', () => ({
  INVENTORY_TABLE: 'BitCRM_Inventory_Test',
  GSI1_NAME: 'CategoryIndex',
  GSI2_NAME: 'TypeIndex',
  GSI3_NAME: 'OwnerIndex',
  GSI4_NAME: 'TransferEntityIndex',
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
import { S3Module } from 'src/common/s3/s3.module';
import { S3Service } from 'src/common/s3/s3.service';
import { StockModule } from 'src/stock/stock.module';
import { ProductsModule } from 'src/products/products.module';
import { WarehousesModule } from 'src/warehouses/warehouses.module';
import { ContainersModule } from 'src/containers/containers.module';
import { TransfersModule } from 'src/transfers/transfers.module';
import {
  createTestTable,
  clearTestTable,
  destroyRawClient,
  getTestRedisClient,
} from '../integration/setup';
import type Redis from 'ioredis';

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
// Mock S3 service
// ---------------------------------------------------------------------------
const mockS3Service = {
  getPresignedUploadUrl: jest
    .fn()
    .mockResolvedValue('https://s3.example.com/upload'),
  getPresignedDownloadUrl: jest
    .fn()
    .mockResolvedValue('https://s3.example.com/download'),
  deleteObject: jest.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function createTestUserHeader(user: JwtUser): string {
  return JSON.stringify(user);
}

// ---------------------------------------------------------------------------
// Permission seeds
// ---------------------------------------------------------------------------
const superAdminPermissions = {
  permissions: {
    products: { view: true, create: true, edit: true, delete: true },
    warehouses: { view: true, create: true, edit: true, delete: true },
    containers: { view: true, create: true, edit: true, delete: true },
    transfers: { view: true, create: true, edit: true, delete: true },
  },
  dataScope: {
    products: 'all',
    warehouses: 'all',
    containers: 'all',
    transfers: 'all',
  },
};

const adminPermissions = {
  permissions: {
    products: { view: true, create: true, edit: true, delete: true },
    warehouses: { view: true, create: true, edit: true, delete: false },
    containers: { view: true, create: true, edit: true, delete: false },
    transfers: { view: true, create: true, edit: true, delete: false },
  },
  dataScope: {
    products: 'all',
    warehouses: 'all',
    containers: 'all',
    transfers: 'all',
  },
};

const techPermissions = {
  permissions: {
    products: { view: true, create: false, edit: false, delete: false },
    warehouses: { view: false, create: false, edit: false, delete: false },
    containers: { view: true, create: false, edit: false, delete: false },
    transfers: { view: true, create: false, edit: false, delete: false },
  },
  dataScope: {
    products: 'all',
    warehouses: 'assigned_only',
    containers: 'assigned_only',
    transfers: 'assigned_only',
  },
};

const dispatcherPermissions = {
  permissions: {
    products: { view: true, create: false, edit: false, delete: false },
    warehouses: { view: true, create: false, edit: false, delete: false },
    containers: { view: true, create: false, edit: false, delete: false },
    transfers: { view: true, create: false, edit: false, delete: false },
  },
  dataScope: {
    products: 'all',
    warehouses: 'all',
    containers: 'all',
    transfers: 'all',
  },
};

const readOnlyPermissions = {
  permissions: {
    products: { view: true, create: false, edit: false, delete: false },
    warehouses: { view: true, create: false, edit: false, delete: false },
    containers: { view: true, create: false, edit: false, delete: false },
    transfers: { view: true, create: false, edit: false, delete: false },
  },
  dataScope: {
    products: 'all',
    warehouses: 'all',
    containers: 'all',
    transfers: 'all',
  },
};

async function seedPermissions(redis: Redis): Promise<void> {
  await redis.set(
    'role:permissions:role-super-admin',
    JSON.stringify(superAdminPermissions),
    'EX',
    3600,
  );
  await redis.set(
    'role:permissions:role-admin',
    JSON.stringify(adminPermissions),
    'EX',
    3600,
  );
  await redis.set(
    'role:permissions:role-technician',
    JSON.stringify(techPermissions),
    'EX',
    3600,
  );
  await redis.set(
    'role:permissions:role-dispatcher',
    JSON.stringify(dispatcherPermissions),
    'EX',
    3600,
  );
  await redis.set(
    'role:permissions:role-read-only',
    JSON.stringify(readOnlyPermissions),
    'EX',
    3600,
  );
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
      S3Module,
      StockModule,
      ProductsModule,
      WarehousesModule,
      ContainersModule,
      TransfersModule,
    ],
    providers: [
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_GUARD, useClass: PermissionGuard },
    ],
  })
    .overrideProvider(S3Service)
    .useValue(mockS3Service)
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/inventory');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  await createTestTable();
  redis = getTestRedisClient();
  await seedPermissions(redis);
  await app.init();

  return app;
}

export async function teardownApp(): Promise<void> {
  await clearTestTable();
  if (redis) await redis.quit();
  if (app) await app.close();
  destroyRawClient();
}

export async function cleanupData(): Promise<void> {
  await clearTestTable();
  if (redis) await redis.flushdb();
  await seedPermissions(redis);
}

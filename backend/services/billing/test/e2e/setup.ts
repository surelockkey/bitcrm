import {
  CanActivate,
  ConsoleLogger,
  ExecutionContext,
  Global,
  INestApplication,
  Injectable,
  Module,
  Type,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { PurgeQueueCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  AuthModule,
  HttpExceptionFilter,
  IS_PUBLIC_KEY,
  PermissionCacheReader,
  PermissionGuard,
  SqsConsumerService,
} from '@bitcrm/shared';
import type { JwtUser, ResolvedPermissions } from '@bitcrm/types';
import { json, urlencoded } from 'express';
import Redis from 'ioredis';

/**
 * Cross-service harness: boots the REAL AppModules of crm, inventory, deal and
 * billing in this process, each on its real port, so internal HTTP, SNS/SQS
 * (LocalStack), S3 (LocalStack) and headless Chrome are all exercised for real.
 *
 * The only substitution is Cognito: `AuthModule` is swapped for one whose
 * APP_GUARD accepts `Authorization: Bearer <E2E_TOKEN>` as a Super Admin.
 * The real `PermissionGuard` still runs and resolves that user's permissions
 * from the Redis cache seeded below.
 */

export const E2E_TOKEN = 'e2e-super-admin';
export const AUTH = { authorization: `Bearer ${E2E_TOKEN}` };
/** A technician scoped to `assigned_only` (see TECHNICIAN below). */
export const TECH_TOKEN = 'e2e-technician';
export const TECH_AUTH = { authorization: `Bearer ${TECH_TOKEN}` };

export const E2E_USER: JwtUser = {
  id: 'e2e-super-admin',
  cognitoSub: 'e2e-super-admin-sub',
  email: 'e2e-admin@bitcrm.test',
  roleId: 'e2e-role-super-admin',
  department: 'operations',
};

export const E2E_TECH: JwtUser = {
  // deal-service validates technician ids as UUIDs.
  id: '7e2e7e2e-0000-4000-8000-000000000001',
  cognitoSub: 'e2e-tech-1-sub',
  email: 'e2e-tech@bitcrm.test',
  roleId: 'e2e-role-technician',
  department: 'field',
};

const USERS: Record<string, JwtUser> = {
  [AUTH.authorization]: E2E_USER,
  [TECH_AUTH.authorization]: E2E_TECH,
};

const crud = (...actions: string[]) => Object.fromEntries(actions.map((a) => [a, true]));

const TECHNICIAN: ResolvedPermissions = {
  roleId: E2E_TECH.roleId,
  roleName: 'E2E Technician',
  isSystemRole: false,
  permissions: {
    deals: crud('view', 'edit'),
    contacts: crud('view'),
    invoices: crud('view', 'create', 'send'),
    estimates: crud('view', 'create', 'edit', 'send'),
  },
  dataScope: { deals: 'assigned_only', invoices: 'assigned_only', estimates: 'assigned_only' } as never,
  dealStageTransitions: [],
  hasOverrides: false,
};

const SUPER_ADMIN: ResolvedPermissions = {
  roleId: E2E_USER.roleId,
  roleName: 'Super Admin',
  isSystemRole: true,
  permissions: {},
  dataScope: {},
  dealStageTransitions: ['*->*'],
  hasOverrides: false,
};

@Injectable()
class E2eAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest();
    const user = USERS[request.headers.authorization as string];
    if (!user) throw new UnauthorizedException();
    request.user = { ...user };
    return true;
  }
}

/** Drop-in for `AuthModule`: same exports, same guard order, fake Cognito. */
@Global()
@Module({
  providers: [
    PermissionCacheReader,
    { provide: APP_GUARD, useClass: E2eAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PermissionCacheReader],
})
class E2eAuthModule {}

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

const dynamo = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

/** `<dev table>` → `<dev table>_E2E`: the schema the setup scripts created. */
const TABLES: Array<{ source: string; target: string }> = [
  { source: 'BitCRM_Billing', target: process.env.BILLING_TABLE! },
  { source: 'BitCRM_Deals', target: process.env.DEALS_TABLE! },
  { source: 'BitCRM_Contacts', target: process.env.CONTACTS_TABLE! },
  { source: 'BitCRM_Companies', target: process.env.COMPANIES_TABLE! },
  { source: 'BitCRM_Inventory', target: process.env.INVENTORY_TABLE! },
];

async function cloneTable(source: string, target: string): Promise<void> {
  const { Table } = await dynamo.send(new DescribeTableCommand({ TableName: source }));
  if (!Table) throw new Error(`${source} missing — run \`npm run setup:aws\` in backend/`);
  await dynamo.send(new DeleteTableCommand({ TableName: target })).catch(() => undefined);
  const input: CreateTableCommandInput = {
    TableName: target,
    KeySchema: Table.KeySchema,
    AttributeDefinitions: Table.AttributeDefinitions,
    BillingMode: 'PAY_PER_REQUEST',
    ...(Table.GlobalSecondaryIndexes?.length && {
      GlobalSecondaryIndexes: Table.GlobalSecondaryIndexes.map((g) => ({
        IndexName: g.IndexName,
        KeySchema: g.KeySchema,
        Projection: g.Projection,
      })),
    }),
  };
  await dynamo.send(new CreateTableCommand(input));
  await waitUntilTableExists({ client: dynamo, maxWaitTime: 30 }, { TableName: target });
}

export async function resetTables(): Promise<void> {
  for (const t of TABLES) await cloneTable(t.source, t.target);
}

export async function dropTables(): Promise<void> {
  for (const t of TABLES) {
    await dynamo.send(new DeleteTableCommand({ TableName: t.target })).catch(() => undefined);
  }
}

/** Stale deal-events from an earlier run would be applied to this run's tables. */
export async function purgeDealEventsQueue(): Promise<void> {
  const sqs = new SQSClient({
    region: 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  try {
    await sqs.send(new PurgeQueueCommand({ QueueUrl: process.env.BILLING_DEAL_EVENTS_QUEUE_URL }));
  } catch (err) {
    // LocalStack allows one purge per minute; an in-flight purge is fine.
    if (!/PurgeQueueInProgress/.test(String((err as Error).name))) throw err;
  } finally {
    sqs.destroy();
  }
}

export async function seedPermissions(): Promise<Redis> {
  const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 3 });
  await redis.flushdb();
  await redis.set(`role:permissions:${E2E_USER.roleId}`, JSON.stringify(SUPER_ADMIN), 'EX', 3600);
  await redis.set(`role:permissions:${E2E_TECH.roleId}`, JSON.stringify(TECHNICIAN), 'EX', 3600);
  return redis;
}

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

export interface ServiceSpec {
  name: string;
  port: number;
  prefix: string;
  /** crm registers no ValidationPipe (CLAUDE.md §10) — mirror each main.ts. */
  validation: boolean;
  /** billing replaces the body parser (4mb JSON) and trusts the proxy. */
  billingBody?: boolean;
  load: () => Promise<Type<unknown>>;
}

export const SERVICES: ServiceSpec[] = [
  {
    name: 'crm',
    port: 4002,
    prefix: 'api/crm',
    validation: false,
    load: async () => (await import('../../../crm/src/app.module')).AppModule,
  },
  {
    name: 'inventory',
    port: 4004,
    prefix: 'api/inventory',
    validation: true,
    load: async () => (await import('../../../inventory/src/app.module')).AppModule,
  },
  {
    name: 'deal',
    port: 4003,
    prefix: 'api/deals',
    validation: true,
    load: async () => (await import('../../../deal/src/app.module')).AppModule,
  },
  {
    name: 'billing',
    port: 4008,
    prefix: 'api/billing',
    validation: true,
    billingBody: true,
    load: async () => (await import('../../src/app.module')).AppModule,
  },
];

/** Same pipeline as the service's `main.ts`, minus tracing/docs/pino. */
export async function bootService(spec: ServiceSpec): Promise<INestApplication> {
  const AppModule = await spec.load();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideModule(AuthModule)
    .useModule(E2eAuthModule)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    ...(spec.billingBody && { bodyParser: false }),
  });
  // The testing module's default logger drops warnings; they are how the
  // services report swallowed cross-service failures, so keep them visible.
  app.useLogger(new ConsoleLogger(spec.name, { logLevels: ['error', 'warn'] }));
  if (spec.billingBody) {
    app.use(json({ limit: '4mb' }));
    app.use(urlencoded({ extended: true, limit: '1mb' }));
    app.set('trust proxy', true);
  }
  app.setGlobalPrefix(spec.prefix);
  if (spec.validation) app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(spec.port);
  return app;
}

export async function stopService(app: INestApplication | undefined): Promise<void> {
  if (!app) return;
  try {
    app.get(SqsConsumerService, { strict: false })?.stop();
  } catch {
    // no consumer in this service
  }
  await app.close();
}

export function destroyClients(): void {
  dynamo.destroy();
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export interface ApiResponse<T = any> {
  status: number;
  body: { success: boolean; data: T; error?: { code?: string; message?: string } } & Record<string, any>;
  headers: Headers;
}

export async function call<T = any>(
  method: string,
  url: string,
  opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean | Record<string, string> } = {},
): Promise<ApiResponse<T>> {
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers: {
      ...(opts.auth === false ? {} : typeof opts.auth === 'object' ? opts.auth : AUTH),
      ...(opts.body !== undefined && { 'content-type': 'application/json' }),
      ...opts.headers,
    },
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  if (process.env.E2E_SLOW_MS && Date.now() - started > Number(process.env.E2E_SLOW_MS)) {
    process.stdout.write(`[e2e] slow ${Date.now() - started}ms ${method} ${url} → ${res.status}\n`);
  }
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body, headers: res.headers };
}

/** Polls `probe` until it returns a truthy value (event-driven projections). */
export async function eventually<T>(
  probe: () => Promise<T | undefined | null | false>,
  { timeoutMs = 20_000, intervalMs = 500, label = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await probe();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}${last ? `: ${String(last)}` : ''}`);
}

/**
 * Environment for the cross-service billing flow (`npm run test:e2e -w billing-service`).
 *
 * Runs before any module is imported: table names, topic ARNs, queue URLs and
 * peer URLs are all read at import time. Nothing here comes from
 * `backend/.env` — every AWS client points at the local containers with dummy
 * credentials, so a real AWS key in the developer's shell can never be used.
 */
const E2E_SUFFIX = '_E2E';
const LOCALSTACK = 'http://localhost:4566';
const ACCOUNT = '000000000000';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',

  // Local containers only.
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'local',
  AWS_SECRET_ACCESS_KEY: 'local',
  AWS_ENDPOINT: LOCALSTACK,
  DYNAMODB_ENDPOINT: 'http://localhost:8000',
  // Redis DB 15 is the test database (CLAUDE.md §8); dev data lives in DB 0.
  REDIS_URL: 'redis://127.0.0.1:6379/15',

  // Dedicated tables, cloned from the dev tables' schemas by the harness.
  BILLING_TABLE: `BitCRM_Billing${E2E_SUFFIX}`,
  DEALS_TABLE: `BitCRM_Deals${E2E_SUFFIX}`,
  CONTACTS_TABLE: `BitCRM_Contacts${E2E_SUFFIX}`,
  COMPANIES_TABLE: `BitCRM_Companies${E2E_SUFFIX}`,
  INVENTORY_TABLE: `BitCRM_Inventory${E2E_SUFFIX}`,

  // Real service-to-service HTTP on the real ports.
  INTERNAL_SERVICE_SECRET: 'e2e-internal-secret',
  CRM_SERVICE_URL: 'http://localhost:4002',
  DEAL_SERVICE_URL: 'http://localhost:4003',
  INVENTORY_SERVICE_URL: 'http://localhost:4004',
  // deal-service validates job companies against billing's internal list.
  BILLING_SERVICE_URL: 'http://localhost:4008',
  // Nothing listens here: permissions come from the Redis cache.
  USER_SERVICE_URL: 'http://localhost:4001',

  // SNS → SQS through LocalStack (`npm run setup:aws`).
  DEAL_EVENTS_TOPIC_ARN: `arn:aws:sns:us-east-1:${ACCOUNT}:bitcrm-deal-events`,
  BILLING_EVENTS_TOPIC_ARN: `arn:aws:sns:us-east-1:${ACCOUNT}:bitcrm-billing-events`,
  BILLING_DEAL_EVENTS_QUEUE_URL: `${LOCALSTACK}/${ACCOUNT}/billing-deal-events`,
  ENABLE_SQS_CONSUMER: 'true',

  DOCUMENTS_BUCKET: 'bitcrm-uploads',
  DOCUMENTS_KMS_KEY_ID: 'alias/bitcrm-documents',
  PORTAL_BASE_URL: 'http://portal.e2e.test',
  BILLING_PORTAL_RATE_LIMIT: '30',
});

// Never geocode, never trace, never ship logs.
for (const key of [
  'GOOGLE_MAPS_API_KEY',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'LOKI_URL',
  'USER_EVENTS_TO_DEAL_QUEUE_URL',
  'CONTACT_EVENTS_TOPIC_ARN',
  'INVENTORY_EVENTS_TOPIC_ARN',
  'PUPPETEER_EXECUTABLE_PATH',
  'AWS_PROFILE',
  'AWS_SESSION_TOKEN',
]) {
  delete process.env[key];
}

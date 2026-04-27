import {
  ContactType, ContactSource, ClientType, CrmStatus,
  type Contact, type Company, type JwtUser,
} from '@bitcrm/types';

// Data factories
export function createMockContact(overrides?: Partial<Contact>): Contact {
  return {
    id: 'contact-1', firstName: 'John', lastName: 'Doe',
    phones: ['+14045551234'], emails: ['john@example.com'],
    type: ContactType.RESIDENTIAL, source: ContactSource.MANUAL,
    status: CrmStatus.ACTIVE, createdBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockCompany(overrides?: Partial<Company>): Company {
  return {
    id: 'company-1', title: 'Acme Corp',
    phones: ['+14045559999'], emails: ['info@acme.com'],
    address: '456 Business Ave', clientType: ClientType.COMMERCIAL,
    status: CrmStatus.ACTIVE, createdBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockJwtUser(overrides?: Partial<JwtUser>): JwtUser {
  return {
    id: 'admin-1', cognitoSub: 'cognito-sub-1', email: 'admin@test.com',
    roleId: 'role-admin', department: 'HQ', ...overrides,
  };
}

// Repository mocks
export function createMockContactsRepository() {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByPhone: jest.fn(),
    findByCompany: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    updatePhoneIndex: jest.fn(),
  };
}

export function createMockContactsCacheService() {
  return { get: jest.fn(), set: jest.fn(), invalidate: jest.fn() };
}

export function createMockCompaniesRepository() {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByClientType: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
  };
}

export function createMockCompaniesCacheService() {
  return { get: jest.fn(), set: jest.fn(), invalidate: jest.fn() };
}

export function createMockSnsPublisherService() {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

export function createMockDynamoDbService() {
  return { client: { send: jest.fn() } };
}

export function createMockRedisService() {
  return { client: { get: jest.fn(), set: jest.fn(), del: jest.fn() } };
}

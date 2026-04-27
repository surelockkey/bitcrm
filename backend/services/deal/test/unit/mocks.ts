import {
  ClientType, DealStage, DealPriority, DealStatus, TimelineEventType,
  type Deal, type DealProduct, type TimelineEntry, type JwtUser, type Address,
} from '@bitcrm/types';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------
export function createMockAddress(overrides?: Partial<Address>): Address {
  return {
    street: '123 Main St',
    city: 'Atlanta',
    state: 'GA',
    zip: '30301',
    lat: 33.749,
    lng: -84.388,
    ...overrides,
  };
}

export function createMockDeal(overrides?: Partial<Deal>): Deal {
  return {
    id: 'deal-1',
    dealNumber: 1001,
    contactId: 'contact-1',
    clientType: ClientType.RESIDENTIAL,
    scheduledDate: '2026-04-20',
    scheduledTimeSlot: '09:00-12:00',
    serviceArea: 'Atlanta Metro',
    address: createMockAddress(),
    jobType: 'lockout',
    stage: DealStage.NEW_LEAD,
    assignedDispatcherId: 'dispatcher-1',
    priority: DealPriority.NORMAL,
    tags: [],
    status: DealStatus.ACTIVE,
    createdBy: 'dispatcher-1',
    createdAt: '2026-04-16T10:00:00.000Z',
    updatedAt: '2026-04-16T10:00:00.000Z',
    ...overrides,
  };
}

export function createMockDealProduct(overrides?: Partial<DealProduct>): DealProduct {
  return {
    productId: 'product-1',
    name: 'Kwikset Deadbolt',
    sku: 'KW-DB-001',
    quantity: 1,
    costCompany: 15.0,
    costForTech: 20.0,
    priceClient: 45.0,
    addedBy: 'tech-1',
    addedAt: '2026-04-16T12:00:00.000Z',
    ...overrides,
  };
}

export function createMockTimelineEntry(overrides?: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: 'event-1',
    dealId: 'deal-1',
    eventType: TimelineEventType.CREATED,
    actorId: 'dispatcher-1',
    actorName: 'Jane Dispatcher',
    timestamp: '2026-04-16T10:00:00.000Z',
    details: {},
    ...overrides,
  };
}

export function createMockJwtUser(overrides?: Partial<JwtUser>): JwtUser {
  return {
    id: 'admin-1',
    cognitoSub: 'cognito-sub-1',
    email: 'admin@test.com',
    roleId: 'role-admin',
    department: 'HQ',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Repository mocks
// ---------------------------------------------------------------------------
export function createMockDealsRepository() {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByStage: jest.fn(),
    findByTech: jest.fn(),
    findByContact: jest.fn(),
    findByDispatcher: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    getNextDealNumber: jest.fn(),
  };
}

export function createMockTimelineRepository() {
  return {
    addEntry: jest.fn(),
    findByDeal: jest.fn(),
  };
}

export function createMockDealProductsRepository() {
  return {
    addProduct: jest.fn(),
    removeProduct: jest.fn(),
    findByDeal: jest.fn(),
    findProduct: jest.fn(),
  };
}

export function createMockDealsCacheService() {
  return {
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
  };
}

export function createMockSnsPublisherService() {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

export function createMockInternalHttpService() {
  return {
    validateContact: jest.fn().mockResolvedValue(true),
    getTechnicians: jest.fn().mockResolvedValue([]),
    deductStock: jest.fn().mockResolvedValue(undefined),
    restoreStock: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockDynamoDbService() {
  return { client: { send: jest.fn() } };
}

export function createMockRedisService() {
  return { client: { get: jest.fn(), set: jest.fn(), del: jest.fn() } };
}

import {
  ClientType, DealStage, DealPriority, DealStatus, TimelineEventType,
  ServiceAreaType,
  type Deal, type DealProduct, type TimelineEntry, type JwtUser, type Address,
  type ServiceArea, type JobType, type JobSource,
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
    jobTypeId: 'jobtype-1',
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

export function createMockServiceArea(overrides?: Partial<ServiceArea>): ServiceArea {
  return {
    id: 'area-1',
    name: 'Atlanta Metro',
    priority: 0,
    active: true,
    type: ServiceAreaType.ZIPS,
    definition: { type: ServiceAreaType.ZIPS, zips: [{ zip: '30301', radiusMiles: 10 }] },
    coverage: [{ kind: 'circle', lat: 33.749, lng: -84.388, radiusMiles: 10 }],
    createdBy: 'admin-1',
    createdAt: '2026-04-16T10:00:00.000Z',
    updatedAt: '2026-04-16T10:00:00.000Z',
    ...overrides,
  };
}

export function createMockJobType(overrides?: Partial<JobType>): JobType {
  return {
    id: 'jobtype-1',
    name: 'Lockout',
    priority: 0,
    active: true,
    createdBy: 'admin-1',
    createdAt: '2026-04-16T10:00:00.000Z',
    updatedAt: '2026-04-16T10:00:00.000Z',
    ...overrides,
  };
}

export function createMockJobSource(overrides?: Partial<JobSource>): JobSource {
  return {
    id: 'jobsource-1',
    name: 'Google Ads',
    priority: 0,
    active: true,
    createdBy: 'admin-1',
    createdAt: '2026-04-16T10:00:00.000Z',
    updatedAt: '2026-04-16T10:00:00.000Z',
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
    // Empty page by default so the assign/unassign renumber step is a no-op
    // unless a test sets up a schedule explicitly.
    findByTech: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
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
    listAssignableTechnicians: jest.fn().mockResolvedValue([]),
    getTechnicianEligibility: jest
      .fn()
      .mockResolvedValue({ technicianId: '', assignable: false, jobTypeIds: [], serviceAreaIds: [] }),
    deductStock: jest.fn().mockResolvedValue(undefined),
    restoreStock: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockGeocodingService() {
  return { geocode: jest.fn().mockResolvedValue({ lat: 33.749, lng: -84.388 }) };
}

export function createMockServiceAreasRepository() {
  return {
    create: jest.fn(),
    put: jest.fn(),
    get: jest.fn(),
    listAll: jest.fn().mockResolvedValue([]),
    remove: jest.fn(),
  };
}

export function createMockJobTypesRepository() {
  return {
    create: jest.fn(),
    put: jest.fn(),
    get: jest.fn(),
    listAll: jest.fn().mockResolvedValue([]),
    isReferencedByDeal: jest.fn().mockResolvedValue(false),
    remove: jest.fn(),
  };
}

export function createMockJobSourcesRepository() {
  return {
    create: jest.fn(),
    put: jest.fn(),
    get: jest.fn(),
    listAll: jest.fn().mockResolvedValue([]),
    isReferencedByDeal: jest.fn().mockResolvedValue(false),
    remove: jest.fn(),
  };
}

export function createMockTechnicianEligibilityRepository() {
  return {
    upsert: jest.fn(),
    get: jest.fn(),
    remove: jest.fn(),
    listAll: jest.fn().mockResolvedValue([]),
  };
}

export function createMockDynamoDbService() {
  return { client: { send: jest.fn() } };
}

export function createMockRedisService() {
  return { client: { get: jest.fn(), set: jest.fn(), del: jest.fn() } };
}

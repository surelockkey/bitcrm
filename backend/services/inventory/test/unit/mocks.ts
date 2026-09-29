import { ProductType, InventoryStatus, TransferType, LocationType, InventoryLogAction, DataScope, type Product, type Warehouse, type Container, type Transfer, type TransferItem, type StockItem, type LocationSummary, type InventoryLogEntry, type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import type { CreateProductDto } from 'src/products/dto/create-product.dto';
import type { CreateWarehouseDto } from 'src/warehouses/dto/create-warehouse.dto';
import type { CreateTransferDto } from 'src/transfers/dto/create-transfer.dto';
import type { CreateContainerDto } from 'src/containers/dto/create-container.dto';

// Data factories
export function createMockProduct(overrides?: Partial<Product>): Product {
  return {
    id: 'prod-1', sku: 'SKU-001', name: 'Test Product', category: 'Locks',
    type: ProductType.PRODUCT, costCompany: 10, costTech: 15, priceClient: 25,
    serialTracking: false, minimumStockLevel: 5, status: InventoryStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockWarehouse(overrides?: Partial<Warehouse>): Warehouse {
  return {
    id: 'wh-1', name: 'Main Warehouse', address: '123 Main St',
    status: InventoryStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockContainer(overrides?: Partial<Container>): Container {
  return {
    id: 'container-1', name: 'Van 1', description: 'North route van',
    technicianId: 'tech-1', technicianName: 'John Doe',
    department: 'Atlanta', status: InventoryStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockTransfer(overrides?: Partial<Transfer>): Transfer {
  return {
    id: 'transfer-1', type: TransferType.TRANSFER,
    fromType: LocationType.WAREHOUSE, fromId: 'wh-1',
    toType: LocationType.CONTAINER, toId: 'container-1',
    items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 5 }],
    performedBy: 'admin-1', performedByName: 'admin@test.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockInventoryLogEntry(overrides?: Partial<InventoryLogEntry>): InventoryLogEntry {
  return {
    id: 'log-1', action: InventoryLogAction.STOCK_RECEIVED,
    productId: 'prod-1', productName: 'Test Product', sku: 'SKU-001', quantity: 5,
    toType: LocationType.WAREHOUSE, toId: 'wh-1', toName: 'Main Warehouse',
    userId: 'admin-1', userName: 'admin@test.com',
    createdAt: '2026-09-10T10:00:00.000Z',
    ...overrides,
  };
}

export function createMockStockItem(overrides?: Partial<StockItem>): StockItem {
  return {
    productId: 'prod-1', productName: 'Test Product', quantity: 10,
    updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

export function createMockJwtUser(overrides?: Partial<JwtUser>): JwtUser {
  return {
    id: 'admin-1', cognitoSub: 'cognito-sub-1', email: 'admin@test.com',
    roleId: 'role-admin', department: 'HQ', ...overrides,
  };
}

export function createMockCreateProductDto(overrides?: Partial<CreateProductDto>): CreateProductDto {
  return {
    name: 'Test Product', sku: 'SKU-001', category: 'Locks',
    type: ProductType.PRODUCT, costCompany: 10, costTech: 15, priceClient: 25,
    serialTracking: false, minimumStockLevel: 5, ...overrides,
  } as CreateProductDto;
}

export function createMockCreateWarehouseDto(overrides?: Partial<CreateWarehouseDto>): CreateWarehouseDto {
  return { name: 'Main Warehouse', address: '123 Main St', ...overrides } as CreateWarehouseDto;
}

export function createMockCreateContainerDto(overrides?: Partial<CreateContainerDto>): CreateContainerDto {
  return { name: 'Van 1', description: 'North route van', department: 'Atlanta', ...overrides } as CreateContainerDto;
}

export function createMockCreateTransferDto(overrides?: Partial<CreateTransferDto>): CreateTransferDto {
  return {
    fromType: LocationType.WAREHOUSE, fromId: 'wh-1',
    toType: LocationType.CONTAINER, toId: 'container-1',
    items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 5 }],
    ...overrides,
  } as CreateTransferDto;
}

// Service/Repository mocks
export function createMockProductsRepository() {
  return { create: jest.fn(), findById: jest.fn(), findBySku: jest.fn(), findByBarcode: jest.fn(), findAll: jest.fn(), findByCategory: jest.fn(), findByType: jest.fn(), update: jest.fn(), countAll: jest.fn(), countByCategory: jest.fn(), countByType: jest.fn(), nextNumber: jest.fn().mockResolvedValue(1), raiseCounterTo: jest.fn() };
}

export function createMockProductsService() {
  return {
    create: jest.fn(), findById: jest.fn(), findBySku: jest.fn(), findByBarcode: jest.fn(),
    findAll: jest.fn(), list: jest.fn(), count: jest.fn(), update: jest.fn(), archive: jest.fn(),
    reactivate: jest.fn(), assertStockable: jest.fn().mockResolvedValue(undefined),
    isStockManaged: jest.fn().mockResolvedValue(true),
    // Default: an id this service never persisted, as the stock guards tolerate.
    loadForStock: jest.fn().mockResolvedValue(null),
    // Default: every item is stock-managed, as it is for products BitCRM wrote.
    partitionStockManaged: jest.fn(
      async (items: { productId: string }[]) => ({
        managed: items,
        unmanaged: [] as { productId: string }[],
      }),
    ),
  };
}

export function createMockProductsCacheService() {
  return { get: jest.fn(), set: jest.fn(), invalidate: jest.fn() };
}

export function createMockS3Service() {
  return { getPresignedUploadUrl: jest.fn(), getPresignedDownloadUrl: jest.fn(), deleteObject: jest.fn() };
}

export function createMockWarehousesRepository() {
  return { create: jest.fn(), findById: jest.fn(), findAll: jest.fn(), update: jest.fn(), countAll: jest.fn() };
}

export function createMockContainersRepository() {
  return { create: jest.fn(), findById: jest.fn(), findByTechnicianId: jest.fn(), findAll: jest.fn(), update: jest.fn() , countAll: jest.fn()};
}

export function createMockTransfersRepository() {
  return { create: jest.fn(), findById: jest.fn(), findByEntity: jest.fn(), findAll: jest.fn(), countAll: jest.fn() };
}

export function createMockStockRepository() {
  return {
    getStockLevel: jest.fn(), getStockLevels: jest.fn(), getProductQuantities: jest.fn(),
    incrementStock: jest.fn(), decrementStock: jest.fn(), moveStock: jest.fn(),
  };
}

/** The permissions the guard resolves for a request, as `req.resolvedPermissions` carries them. */
export function createMockResolvedPermissions(
  overrides?: Partial<ResolvedPermissions>,
): ResolvedPermissions {
  return {
    roleId: 'role-admin', roleName: 'Admin', isSystemRole: false,
    permissions: {
      products: { view: true, create: true, edit: true, delete: true },
      warehouses: { view: true, create: true, edit: true, delete: false },
      containers: { view: true, create: true, edit: true, delete: false },
    },
    dataScope: { products: DataScope.ALL, warehouses: DataScope.ALL, containers: DataScope.ALL },
    dealStageTransitions: [], hasOverrides: false,
    ...overrides,
  };
}

export function createMockLocationSummary(overrides?: Partial<LocationSummary>): LocationSummary {
  return {
    type: 'container', id: 'container-1', name: 'Van 1', status: InventoryStatus.ACTIVE,
    ...overrides,
  };
}

export function createMockLocationsRepository() {
  return { findLocation: jest.fn(), listAll: jest.fn().mockResolvedValue([]) };
}

export function createMockStockService() {
  return { receive: jest.fn(), deduct: jest.fn(), transfer: jest.fn() };
}

export function createMockTransfersService() {
  return {
    createTransfer: jest.fn(), receiveStock: jest.fn(), returnStock: jest.fn(),
    deductStock: jest.fn(), restoreStock: jest.fn(),
    findById: jest.fn(), findByEntity: jest.fn(), findAll: jest.fn(), list: jest.fn(), count: jest.fn(),
  };
}

export function createMockInventoryLogRepository() {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    queryMonth: jest.fn().mockResolvedValue({ items: [], lastKey: undefined }),
    queryProduct: jest.fn().mockResolvedValue({ items: [], lastKey: undefined }),
    countMonth: jest.fn().mockResolvedValue({ total: 0, atLeast: false }),
    countProduct: jest.fn().mockResolvedValue({ total: 0, atLeast: false }),
  };
}

/** The audit log never throws at its callers, so the default is a silent success. */
export function createMockInventoryLogService() {
  return {
    record: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
    count: jest.fn().mockResolvedValue({ total: 0, atLeast: false }),
  };
}

export function createMockDynamoDbService() {
  return { client: { send: jest.fn() } };
}

export function createMockRedisService() {
  return { client: { get: jest.fn(), set: jest.fn(), del: jest.fn() } };
}

export function createMockItemCategory(overrides?: Partial<import('@bitcrm/types').ProductCategory>): import('@bitcrm/types').ProductCategory {
  return {
    id: 'cat-1', name: 'Locks', active: true, createdBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockBrand(overrides?: Partial<import('@bitcrm/types').Brand>): import('@bitcrm/types').Brand {
  return {
    id: 'brand-1', name: 'Schlage', active: true, createdBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockCatalogRepository() {
  return {
    create: jest.fn(), put: jest.fn(), get: jest.fn(),
    listAll: jest.fn().mockResolvedValue([]), remove: jest.fn(),
    findByName: jest.fn().mockResolvedValue(null),
    isReferencedByProduct: jest.fn().mockResolvedValue(false),
  };
}

export function createMockItemCategoriesService() {
  return {
    ensureCategory: jest.fn().mockResolvedValue({ category: createMockItemCategory(), created: false }),
    ensureUncategorized: jest.fn().mockResolvedValue({
      category: createMockItemCategory({ id: 'cat-uncat', name: 'Uncategorized' }),
      created: false,
    }),
  };
}

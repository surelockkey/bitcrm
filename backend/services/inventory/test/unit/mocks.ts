import { ProductType, InventoryStatus, TransferType, LocationType, type Product, type Warehouse, type Container, type Transfer, type TransferItem, type StockItem, type JwtUser } from '@bitcrm/types';
import type { CreateProductDto } from 'src/products/dto/create-product.dto';
import type { CreateWarehouseDto } from 'src/warehouses/dto/create-warehouse.dto';
import type { CreateTransferDto } from 'src/transfers/dto/create-transfer.dto';
import type { EnsureContainerDto } from 'src/containers/dto/ensure-container.dto';

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
    id: 'container-1', technicianId: 'tech-1', technicianName: 'John Doe',
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

export function createMockEnsureContainerDto(overrides?: Partial<EnsureContainerDto>): EnsureContainerDto {
  return { technicianId: 'tech-1', technicianName: 'John Doe', department: 'Atlanta', ...overrides } as EnsureContainerDto;
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
  return { create: jest.fn(), findById: jest.fn(), findBySku: jest.fn(), findAll: jest.fn(), findByCategory: jest.fn(), findByType: jest.fn(), update: jest.fn() };
}

export function createMockProductsCacheService() {
  return { get: jest.fn(), set: jest.fn(), invalidate: jest.fn() };
}

export function createMockS3Service() {
  return { getPresignedUploadUrl: jest.fn(), getPresignedDownloadUrl: jest.fn(), deleteObject: jest.fn() };
}

export function createMockWarehousesRepository() {
  return { create: jest.fn(), findById: jest.fn(), findAll: jest.fn(), update: jest.fn() };
}

export function createMockContainersRepository() {
  return { create: jest.fn(), findById: jest.fn(), findByTechnicianId: jest.fn(), findAll: jest.fn(), update: jest.fn() };
}

export function createMockTransfersRepository() {
  return { create: jest.fn(), findById: jest.fn(), findByEntity: jest.fn(), findAll: jest.fn() };
}

export function createMockStockRepository() {
  return { getStockLevel: jest.fn(), getStockLevels: jest.fn(), incrementStock: jest.fn(), decrementStock: jest.fn() };
}

export function createMockStockService() {
  return { receive: jest.fn(), deduct: jest.fn(), transfer: jest.fn() };
}

export function createMockDynamoDbService() {
  return { client: { send: jest.fn() } };
}

export function createMockRedisService() {
  return { client: { get: jest.fn(), set: jest.fn(), del: jest.fn() } };
}

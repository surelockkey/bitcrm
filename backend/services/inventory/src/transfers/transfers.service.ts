import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BusinessMetricsService,
  SnsPublisherService,
  RedisService,
  cachedCount,
  countCacheKey,
} from '@bitcrm/shared';
import { randomUUID } from 'crypto';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import {
  type InventoryLogEntry,
  type JwtUser,
  type ListCount,
  type LocationSummary,
  type Transfer,
  type TransferItem,
  InventoryLogAction,
  TransferType,
  LocationType,
} from '@bitcrm/types';
import { TransfersRepository } from './transfers.repository';
import { StockService } from '../stock/stock.service';
import { LocationsRepository } from '../stock/locations.repository';
import { ContainerAssignmentResolver } from '../user-containers/container-assignment.resolver';
import { ProductsService } from '../products/products.service';
import { InventoryLogService } from '../inventory-log/inventory-log.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { ReturnStockDto } from './dto/return-stock.dto';
import { DeductStockDto } from './dto/deduct-stock.dto';
import { RestoreStockDto } from './dto/restore-stock.dto';
import { ListTransfersQueryDto } from './dto/list-transfers-query.dto';

const VALID_TRANSFER_ROUTES = new Set([
  `${LocationType.WAREHOUSE}->${LocationType.CONTAINER}`,
  `${LocationType.CONTAINER}->${LocationType.WAREHOUSE}`,
  `${LocationType.CONTAINER}->${LocationType.CONTAINER}`,
  // Workiz moves stock between stores too.
  `${LocationType.WAREHOUSE}->${LocationType.WAREHOUSE}`,
]);

/** How long a list count stays good enough. Matches the deals tab counts. */
const COUNT_TTL_SECONDS = 30;

/** The stock partition of a location: WAREHOUSE#<id> | CONTAINER#<id>. */
function locationPK(type: LocationType, id: string): string {
  return `${type.toUpperCase()}#${id}`;
}

/** What an audit-log line carries besides the item: where, why, who. */
type MovementFields = Pick<InventoryLogEntry, 'userId' | 'userName'> &
  Partial<
    Pick<
      InventoryLogEntry,
      'fromType' | 'fromId' | 'fromName' | 'toType' | 'toId' | 'toName' | 'dealId' | 'reason'
    >
  >;

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly repository: TransfersRepository,
    private readonly stockService: StockService,
    private readonly assignments: ContainerAssignmentResolver,
    private readonly productsService: ProductsService,
    private readonly locationsRepository: LocationsRepository,
    @Optional() private readonly inventoryLog?: InventoryLogService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Deal-service callers identify a technician's container by the *technician's*
   * id, but stock is keyed by the container's own id. Resolve a technician id
   * to the container they are assigned to (user containers, else the legacy
   * `technicianId` link); an id that names no user with a container (e.g. a
   * container id passed directly by the transfers UI) is returned as-is so
   * those callers keep working unchanged.
   */
  private async resolveContainerId(
    containerOrTechnicianId: string,
  ): Promise<string> {
    const containerId = await this.assignments.containerIdForUser(containerOrTechnicianId);
    return containerId ?? containerOrTechnicianId;
  }

  /**
   * Workiz "Transfer": between two locations that both exist — a typo in
   * `toId` would otherwise take the units off a real location and park them
   * under a key no list knows. The same item rules as a receive.
   */
  async createTransfer(dto: CreateTransferDto, user: JwtUser): Promise<Transfer> {
    const route = `${dto.fromType}->${dto.toType}`;
    if (!VALID_TRANSFER_ROUTES.has(route)) {
      throw new BadRequestException(
        `Invalid transfer route: ${dto.fromType} -> ${dto.toType}`,
      );
    }
    if (dto.fromType === dto.toType && dto.fromId === dto.toId) {
      throw new BadRequestException('Source and destination are the same location');
    }

    const from = await this.requireLocation(dto.fromType, dto.fromId);
    const to = await this.requireLocation(dto.toType, dto.toId);
    const { items, skipped } = await this.stockableItems(dto.items, 'stock transfer');

    await this.stockService.transfer(
      locationPK(dto.fromType, dto.fromId),
      locationPK(dto.toType, dto.toId),
      items,
    );

    const transfer: Transfer = {
      id: randomUUID(),
      type: TransferType.TRANSFER,
      fromType: dto.fromType,
      fromId: dto.fromId,
      toType: dto.toType,
      toId: dto.toId,
      items,
      ...(skipped.length > 0 && { skippedItems: skipped }),
      performedBy: user.id,
      performedByName: user.email,
      notes: dto.notes,
      createdAt: new Date().toISOString(),
    };

    await this.repository.create(transfer);
    this.businessMetrics?.stockTransfers.inc({ type: 'transfer' });
    publishInventoryEvent(this.snsPublisher, this.logger, 'transfer.created', {
      transferId: transfer.id,
    });
    await this.recordMovement(InventoryLogAction.STOCK_MOVED, items, {
      fromType: dto.fromType,
      fromId: dto.fromId,
      fromName: from.name,
      toType: dto.toType,
      toId: dto.toId,
      toName: to.name,
      userId: user.id,
      userName: user.email,
    });
    return transfer;
  }

  /**
   * Workiz "Add to stock": from the supplier into any location that holds
   * stock. The one receive path — POST /warehouses/:id/receive lands here too.
   */
  async receiveStock(dto: ReceiveStockDto, user: JwtUser): Promise<Transfer> {
    const location = await this.requireLocation(dto.toType, dto.toId);
    const { items, skipped } = await this.stockableItems(dto.items, 'stock receive');

    await this.stockService.receive(locationPK(dto.toType, dto.toId), items);

    const transfer: Transfer = {
      id: randomUUID(),
      type: TransferType.RECEIVE,
      fromType: LocationType.SUPPLIER,
      fromId: null,
      toType: dto.toType,
      toId: dto.toId,
      items,
      ...(skipped.length > 0 && { skippedItems: skipped }),
      performedBy: user.id,
      performedByName: user.email,
      notes: dto.notes,
      createdAt: new Date().toISOString(),
    };

    await this.repository.create(transfer);
    this.businessMetrics?.stockTransfers.inc({ type: 'receive' });
    publishInventoryEvent(this.snsPublisher, this.logger, 'transfer.created', {
      transferId: transfer.id,
    });
    await this.recordMovement(InventoryLogAction.STOCK_RECEIVED, items, {
      toType: dto.toType,
      toId: dto.toId,
      toName: location.name,
      userId: user.id,
      userName: user.email,
    });
    return transfer;
  }

  /**
   * Workiz "Return": stock leaves a location without a job — recalled,
   * damaged or lost. Insufficient stock is the stock row's own 400.
   */
  async returnStock(dto: ReturnStockDto, user: JwtUser): Promise<Transfer> {
    const location = await this.requireLocation(dto.fromType, dto.fromId);
    const { items, skipped } = await this.stockableItems(dto.items, 'stock return');

    await this.stockService.deduct(locationPK(dto.fromType, dto.fromId), items);

    const transfer: Transfer = {
      id: randomUUID(),
      type: TransferType.RETURN,
      fromType: dto.fromType,
      fromId: dto.fromId,
      toType: null,
      toId: null,
      items,
      ...(skipped.length > 0 && { skippedItems: skipped }),
      reason: dto.reason,
      performedBy: user.id,
      performedByName: user.email,
      notes: dto.notes,
      createdAt: new Date().toISOString(),
    };

    await this.repository.create(transfer);
    this.businessMetrics?.stockTransfers.inc({ type: 'return' });
    publishInventoryEvent(this.snsPublisher, this.logger, 'transfer.created', {
      transferId: transfer.id,
    });
    await this.recordMovement(InventoryLogAction.STOCK_RETURNED, items, {
      fromType: dto.fromType,
      fromId: dto.fromId,
      fromName: location.name,
      reason: dto.reason,
      userId: user.id,
      userName: user.email,
    });
    return transfer;
  }

  /**
   * Drop the items the price book does not track (`manageStock: false` — 6 643
   * imported product-type items). They have no stock counter, so deducting
   * would fail with "Insufficient stock" and restoring would invent stock that
   * was never counted. Products written by BitCRM carry no `manageStock`
   * attribute and are always managed.
   */
  private async onlyStockManaged<T extends { productId: string; productName: string }>(
    items: T[],
    action: string,
  ): Promise<T[]> {
    const { managed, unmanaged } =
      await this.productsService.partitionStockManaged(items);
    if (unmanaged.length > 0) {
      this.logger.log(
        `Skipped ${action} for ${unmanaged.length} non-stock-managed item(s): ` +
          unmanaged.map((i) => i.productName).join(', '),
      );
    }
    return managed;
  }

  /**
   * Items as the catalog names them. The stock row, the journal and the audit
   * log (whose `searchText` the search filter runs against) carry the
   * product's own name, never one the request body chose; an id the catalog
   * does not hold keeps what the caller sent. The product was read a moment
   * ago by the guards, so this is the cache.
   */
  private async withCatalogNames<T extends { productId: string; productName: string }>(
    items: T[],
  ): Promise<T[]> {
    const named: T[] = [];
    for (const item of items) {
      const product = await this.productsService.loadForStock(item.productId).catch(() => null);
      named.push(product?.name ? { ...item, productName: product.name } : item);
    }
    return named;
  }

  /**
   * The user-facing movements' guard: services are rejected, untracked items
   * dropped — and handed back, so the response can say what did not move —
   * and nothing left is a 400. A silent no-op would hide why the count did
   * not change.
   */
  private async stockableItems<T extends { productId: string; productName: string }>(
    items: T[],
    action: string,
  ): Promise<{ items: T[]; skipped: T[] }> {
    await this.productsService.assertStockable(items.map((i) => i.productId));
    const managed = await this.onlyStockManaged(items, action);
    if (managed.length === 0) {
      throw new BadRequestException('None of the items are stock-managed');
    }
    const skipped = items.filter((item) => !managed.includes(item));
    return { items: await this.withCatalogNames(managed), skipped };
  }

  async deductStock(dto: DeductStockDto) {
    await this.productsService.assertStockable(dto.items.map((i) => i.productId));
    const items = await this.withCatalogNames(
      await this.onlyStockManaged(dto.items, 'stock deduction'),
    );
    if (items.length === 0) return;

    const containerId = await this.resolveContainerId(dto.containerId);
    await this.stockService.deduct(`CONTAINER#${containerId}`, items);
    this.businessMetrics?.stockDeductions.inc();

    await this.repository.create({
      id: randomUUID(),
      type: TransferType.DEDUCT,
      fromType: LocationType.CONTAINER,
      fromId: containerId,
      toType: null,
      toId: null,
      items,
      performedBy: dto.performedBy,
      performedByName: dto.performedByName,
      dealId: dto.dealId,
      // Kept for readers written before `dealId` was its own field.
      notes: `Deal: ${dto.dealId}`,
      createdAt: new Date().toISOString(),
    });
    await this.recordMovement(
      InventoryLogAction.STOCK_USED,
      items,
      {
        fromType: LocationType.CONTAINER,
        fromId: containerId,
        fromName: await this.locationName(LocationType.CONTAINER, containerId),
        dealId: dto.dealId,
        userId: dto.performedBy,
        userName: dto.performedByName,
      },
      true,
    );
  }

  async restoreStock(dto: RestoreStockDto) {
    await this.productsService.assertStockable(dto.items.map((i) => i.productId));
    // Symmetrical with deductStock: what was never deducted is never restored.
    const items = await this.withCatalogNames(
      await this.onlyStockManaged(dto.items, 'stock restore'),
    );
    if (items.length === 0) return;

    const containerId = await this.resolveContainerId(dto.containerId);
    await this.stockService.receive(`CONTAINER#${containerId}`, items);
    this.businessMetrics?.stockTransfers.inc({ type: 'restore' });

    await this.repository.create({
      id: randomUUID(),
      type: TransferType.RESTORE,
      fromType: null,
      fromId: null,
      toType: LocationType.CONTAINER,
      toId: containerId,
      items,
      performedBy: dto.performedBy,
      performedByName: dto.performedByName,
      dealId: dto.dealId,
      notes: `Deal: ${dto.dealId}`,
      createdAt: new Date().toISOString(),
    });
    await this.recordMovement(
      InventoryLogAction.STOCK_RESTORED,
      items,
      {
        toType: LocationType.CONTAINER,
        toId: containerId,
        toName: await this.locationName(LocationType.CONTAINER, containerId),
        dealId: dto.dealId,
        userId: dto.performedBy,
        userName: dto.performedByName,
      },
      true,
    );
  }

  private async requireLocation(type: LocationType, id: string): Promise<LocationSummary> {
    const location = await this.locationsRepository.findLocation(type, id);
    if (!location) {
      const label = type === LocationType.WAREHOUSE ? 'Warehouse' : 'Container';
      throw new NotFoundException(`${label} "${id}" not found`);
    }
    return location;
  }

  /**
   * The name the log shows for a location on the internal deduct/restore
   * paths — its id when it has no row to name it (deal-service may name a
   * container this service never persisted).
   */
  private async locationName(type: LocationType, id: string): Promise<string> {
    try {
      const location = await this.locationsRepository.findLocation(type, id);
      return location?.name || id;
    } catch {
      return id;
    }
  }

  /**
   * One audit-log line per item. The product is read again — the stock guards
   * cached it a moment ago — for its name and SKU and, on a job use or
   * restore, for the price and cost the "Inventory usage" report values it
   * at. An id this service never persisted simply has none of those. Never
   * fails the movement.
   */
  private async recordMovement(
    action: InventoryLogAction,
    items: TransferItem[],
    fields: MovementFields,
    withUnitValues = false,
  ): Promise<void> {
    if (!this.inventoryLog) return;
    for (const item of items) {
      const product = await this.productsService
        .loadForStock(item.productId)
        .catch(() => null);
      await this.inventoryLog.record({
        action,
        productId: item.productId,
        productName: product?.name ?? item.productName,
        sku: product?.sku,
        quantity: item.quantity,
        ...fields,
        ...(withUnitValues && product
          ? { unitPrice: product.priceClient, unitCost: product.costCompany }
          : {}),
      });
    }
  }

  async findById(id: string) {
    return this.repository.findById(id);
  }

  async findByEntity(entityType: string, entityId: string, limit: number, cursor?: string) {
    return this.repository.findByEntity(entityType, entityId, limit, cursor);
  }

  async findAll(limit: number, cursor?: string) {
    return this.repository.findAll(limit, cursor);
  }

  async list(query: ListTransfersQueryDto) {
    return this.repository.findAll(query.limit || 20, query.cursor, { type: query.type });
  }

  /**
   * How many transfers the list holds under the same `type` filter, behind a
   * short cache keyed on it — the number the panel turns into "Page 2 of 7".
   */
  async count(query: Pick<ListTransfersQueryDto, 'type'> = {}): Promise<ListCount> {
    const filters = query.type ? { type: query.type } : {};
    const take = () => this.repository.countAll(filters);
    if (!this.redis) return take();
    return cachedCount(
      this.redis.client,
      countCacheKey('transfers', filters),
      COUNT_TTL_SECONDS,
      take,
    );
  }
}

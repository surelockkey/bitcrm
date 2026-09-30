import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  SnsPublisherService,
  RedisService,
  cachedCount,
  countCacheKey,
} from '@bitcrm/shared';
import { randomUUID } from 'crypto';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import {
  type Warehouse,
  type Transfer,
  type TransferItem,
  type StockItem,
  type JwtUser,
  type ListCount,
  InventoryStatus,
  LocationType,
} from '@bitcrm/types';
import { WarehousesRepository } from './warehouses.repository';
import { StockRepository } from '../stock/stock.repository';
import { TransfersService } from '../transfers/transfers.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { ListWarehousesQueryDto } from './dto/list-warehouses-query.dto';

/** How long a list count stays good enough. Matches the containers count. */
const COUNT_TTL_SECONDS = 30;

@Injectable()
export class WarehousesService {
  private readonly logger = new Logger(WarehousesService.name);

  constructor(
    private readonly repository: WarehousesRepository,
    private readonly stockRepository: StockRepository,
    private readonly transfersService: TransfersService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async create(dto: CreateWarehouseDto): Promise<Warehouse> {
    const now = new Date().toISOString();
    const warehouse: Warehouse = {
      id: randomUUID(),
      ...dto,
      status: InventoryStatus.ACTIVE,
      // Empty, and kept by every stock write from here on.
      totalUnits: 0,
      uniqueItems: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(warehouse);
    publishInventoryEvent(this.snsPublisher, this.logger, 'warehouse.created', {
      warehouseId: warehouse.id,
    });
    return warehouse;
  }

  async findById(id: string): Promise<Warehouse> {
    const warehouse = await this.repository.findById(id);
    if (!warehouse) {
      throw new NotFoundException(`Warehouse "${id}" not found`);
    }
    return warehouse;
  }

  async findAll(limit: number, cursor?: string) {
    return this.repository.findAll(limit, cursor);
  }

  async list(query: ListWarehousesQueryDto) {
    return this.repository.findAll(query.limit || 20, query.cursor, {
      search: query.search,
      status: query.status,
    });
  }

  /** How many warehouses the list holds — the number behind "Page 2 of 7". */
  async count(query: ListWarehousesQueryDto): Promise<ListCount> {
    const filters = { search: query.search, status: query.status };

    const take = () => this.repository.countAll(filters);
    if (!this.redis) return take();
    return cachedCount(
      this.redis.client,
      countCacheKey('warehouses', filters),
      COUNT_TTL_SECONDS,
      take,
    );
  }

  async update(id: string, dto: UpdateWarehouseDto): Promise<Warehouse> {
    await this.findById(id);
    const warehouse = await this.repository.update(id, dto);
    publishInventoryEvent(this.snsPublisher, this.logger, 'warehouse.updated', {
      warehouseId: id,
    });
    return warehouse;
  }

  async archive(id: string): Promise<Warehouse> {
    const warehouse = await this.repository.update(id, {
      status: InventoryStatus.ARCHIVED,
    });
    publishInventoryEvent(this.snsPublisher, this.logger, 'warehouse.updated', {
      warehouseId: id,
    });
    return warehouse;
  }

  async getStock(warehouseId: string): Promise<StockItem[]> {
    await this.findById(warehouseId);
    return this.stockRepository.getStockLevels(`WAREHOUSE#${warehouseId}`);
  }

  /**
   * One receive path: the same checks, journal row and audit log as a receive
   * into a container. An unknown warehouse is its 404; the transfer comes
   * back with the items that moved and the ones that did not.
   */
  async receiveStock(
    warehouseId: string,
    items: TransferItem[],
    user: JwtUser,
  ): Promise<Transfer> {
    return this.transfersService.receiveStock(
      { toType: LocationType.WAREHOUSE, toId: warehouseId, items },
      user,
    );
  }
}

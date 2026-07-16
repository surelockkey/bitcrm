import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import { randomUUID } from 'crypto';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import {
  type Warehouse,
  type TransferItem,
  type StockItem,
  type JwtUser,
  InventoryStatus,
  TransferType,
  LocationType,
} from '@bitcrm/types';
import { WarehousesRepository } from './warehouses.repository';
import { StockService } from '../stock/stock.service';
import { StockRepository } from '../stock/stock.repository';
import { TransfersRepository } from '../transfers/transfers.repository';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { ListWarehousesQueryDto } from './dto/list-warehouses-query.dto';

@Injectable()
export class WarehousesService {
  private readonly logger = new Logger(WarehousesService.name);

  constructor(
    private readonly repository: WarehousesRepository,
    private readonly stockService: StockService,
    private readonly stockRepository: StockRepository,
    private readonly transfersRepository: TransfersRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  async create(dto: CreateWarehouseDto): Promise<Warehouse> {
    const now = new Date().toISOString();
    const warehouse: Warehouse = {
      id: randomUUID(),
      ...dto,
      status: InventoryStatus.ACTIVE,
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
    return this.repository.findAll(query.limit || 20, query.cursor);
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

  async receiveStock(
    warehouseId: string,
    items: TransferItem[],
    user: JwtUser,
  ): Promise<void> {
    await this.findById(warehouseId);
    await this.stockService.receive(`WAREHOUSE#${warehouseId}`, items);

    await this.transfersRepository.create({
      id: randomUUID(),
      type: TransferType.RECEIVE,
      fromType: LocationType.SUPPLIER,
      fromId: null,
      toType: LocationType.WAREHOUSE,
      toId: warehouseId,
      items,
      performedBy: user.id,
      performedByName: user.email,
      createdAt: new Date().toISOString(),
    });
  }
}

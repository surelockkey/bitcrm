import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
  constructor(
    private readonly repository: WarehousesRepository,
    private readonly stockService: StockService,
    private readonly stockRepository: StockRepository,
    private readonly transfersRepository: TransfersRepository,
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
    return warehouse;
  }

  async findById(id: string): Promise<Warehouse> {
    const warehouse = await this.repository.findById(id);
    if (!warehouse) {
      throw new NotFoundException(`Warehouse "${id}" not found`);
    }
    return warehouse;
  }

  async list(query: ListWarehousesQueryDto) {
    return this.repository.findAll(query.limit || 20, query.cursor);
  }

  async update(id: string, dto: UpdateWarehouseDto): Promise<Warehouse> {
    await this.findById(id);
    return this.repository.update(id, dto);
  }

  async archive(id: string): Promise<Warehouse> {
    return this.repository.update(id, { status: InventoryStatus.ARCHIVED });
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

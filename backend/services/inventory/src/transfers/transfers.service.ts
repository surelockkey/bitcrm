import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import { randomUUID } from 'crypto';
import {
  type JwtUser,
  TransferType,
  LocationType,
} from '@bitcrm/types';
import { TransfersRepository } from './transfers.repository';
import { StockService } from '../stock/stock.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { DeductStockDto } from './dto/deduct-stock.dto';
import { RestoreStockDto } from './dto/restore-stock.dto';
import { ListTransfersQueryDto } from './dto/list-transfers-query.dto';

const VALID_TRANSFER_ROUTES = new Set([
  `${LocationType.WAREHOUSE}->${LocationType.CONTAINER}`,
  `${LocationType.CONTAINER}->${LocationType.WAREHOUSE}`,
  `${LocationType.CONTAINER}->${LocationType.CONTAINER}`,
]);

@Injectable()
export class TransfersService {
  constructor(
    private readonly repository: TransfersRepository,
    private readonly stockService: StockService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  async createTransfer(dto: CreateTransferDto, user: JwtUser) {
    const route = `${dto.fromType}->${dto.toType}`;
    if (!VALID_TRANSFER_ROUTES.has(route)) {
      throw new BadRequestException(
        `Invalid transfer route: ${dto.fromType} -> ${dto.toType}`,
      );
    }

    const fromPK = `${dto.fromType.toUpperCase()}#${dto.fromId}`;
    const toPK = `${dto.toType.toUpperCase()}#${dto.toId}`;

    await this.stockService.transfer(fromPK, toPK, dto.items);

    const transfer = {
      id: randomUUID(),
      type: TransferType.TRANSFER,
      fromType: dto.fromType,
      fromId: dto.fromId,
      toType: dto.toType,
      toId: dto.toId,
      items: dto.items,
      performedBy: user.id,
      performedByName: user.email,
      notes: dto.notes,
      createdAt: new Date().toISOString(),
    };

    await this.repository.create(transfer);
    this.businessMetrics?.stockTransfers.inc({ type: 'transfer' });
    return transfer;
  }

  async deductStock(dto: DeductStockDto) {
    await this.stockService.deduct(`CONTAINER#${dto.containerId}`, dto.items);
    this.businessMetrics?.stockDeductions.inc();

    await this.repository.create({
      id: randomUUID(),
      type: TransferType.DEDUCT,
      fromType: LocationType.CONTAINER,
      fromId: dto.containerId,
      toType: null,
      toId: null,
      items: dto.items,
      performedBy: dto.performedBy,
      performedByName: dto.performedByName,
      notes: `Deal: ${dto.dealId}`,
      createdAt: new Date().toISOString(),
    });
  }

  async restoreStock(dto: RestoreStockDto) {
    await this.stockService.receive(`CONTAINER#${dto.containerId}`, dto.items);
    this.businessMetrics?.stockTransfers.inc({ type: 'restore' });

    await this.repository.create({
      id: randomUUID(),
      type: TransferType.RESTORE,
      fromType: null,
      fromId: null,
      toType: LocationType.CONTAINER,
      toId: dto.containerId,
      items: dto.items,
      performedBy: dto.performedBy,
      performedByName: dto.performedByName,
      notes: `Deal: ${dto.dealId}`,
      createdAt: new Date().toISOString(),
    });
  }

  async findById(id: string) {
    return this.repository.findById(id);
  }

  async findByEntity(entityType: string, entityId: string, limit: number, cursor?: string) {
    return this.repository.findByEntity(entityType, entityId, limit, cursor);
  }

  async list(query: ListTransfersQueryDto) {
    return this.repository.findAll(query.limit || 20, query.cursor);
  }
}

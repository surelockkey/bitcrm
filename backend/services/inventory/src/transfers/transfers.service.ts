import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService, SnsPublisherService } from '@bitcrm/shared';
import { randomUUID } from 'crypto';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import {
  type JwtUser,
  TransferType,
  LocationType,
} from '@bitcrm/types';
import { TransfersRepository } from './transfers.repository';
import { StockService } from '../stock/stock.service';
import { StockRepository } from '../stock/stock.repository';
import { ContainersRepository } from '../containers/containers.repository';
import { ProductsService } from '../products/products.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { DeductStockDto } from './dto/deduct-stock.dto';
import { RestoreStockDto } from './dto/restore-stock.dto';
import { ListTransfersQueryDto } from './dto/list-transfers-query.dto';
import { MoveItemDto } from './dto/move-item.dto';

const VALID_TRANSFER_ROUTES = new Set([
  `${LocationType.WAREHOUSE}->${LocationType.CONTAINER}`,
  `${LocationType.CONTAINER}->${LocationType.WAREHOUSE}`,
  `${LocationType.CONTAINER}->${LocationType.CONTAINER}`,
]);

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly repository: TransfersRepository,
    private readonly stockService: StockService,
    private readonly stockRepository: StockRepository,
    private readonly containersRepository: ContainersRepository,
    private readonly productsService: ProductsService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  /**
   * Deal-service callers identify a technician's container by the *technician's*
   * id, but stock is keyed by the container's own id. Resolve a technician id
   * to their container id; an id that matches no technician (e.g. a container id
   * passed directly by the transfers UI) is returned as-is so those callers keep
   * working unchanged.
   */
  private async resolveContainerId(
    containerOrTechnicianId: string,
  ): Promise<string> {
    const container = await this.containersRepository.findByTechnicianId(
      containerOrTechnicianId,
    );
    return container ? container.id : containerOrTechnicianId;
  }

  async createTransfer(dto: CreateTransferDto, user: JwtUser) {
    const route = `${dto.fromType}->${dto.toType}`;
    if (!VALID_TRANSFER_ROUTES.has(route)) {
      throw new BadRequestException(
        `Invalid transfer route: ${dto.fromType} -> ${dto.toType}`,
      );
    }

    await this.productsService.assertStockable(dto.items.map((i) => i.productId));

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
    publishInventoryEvent(this.snsPublisher, this.logger, 'transfer.created', {
      transferId: transfer.id,
    });
    return transfer;
  }

  /**
   * Workiz's "Move Item": one product leaves one location and is split across
   * several destinations at once.
   *
   * The whole total is checked against the source *before* the first leg moves,
   * because the legs apply one at a time — validating per leg would let an
   * over-committed move drain the source partway and then fail, leaving stock
   * scattered with no single record to undo.
   */
  async moveItem(dto: MoveItemDto, user: JwtUser) {
    const destinations = dto.destinations.filter((d) => d.quantity > 0);
    if (destinations.length === 0) {
      throw new BadRequestException('Move must send at least one unit somewhere');
    }

    const seen = new Set<string>();
    for (const destination of destinations) {
      const key = `${destination.toType}#${destination.toId}`;
      if (key === `${dto.fromType}#${dto.fromId}`) {
        throw new BadRequestException(
          'A product cannot be moved to the location it is already in',
        );
      }
      if (seen.has(key)) {
        throw new BadRequestException(
          `Destination "${destination.toId}" is listed more than once`,
        );
      }
      seen.add(key);

      const route = `${dto.fromType}->${destination.toType}`;
      if (!VALID_TRANSFER_ROUTES.has(route)) {
        throw new BadRequestException(`Invalid transfer route: ${route}`);
      }
    }

    await this.productsService.assertStockable([dto.productId]);

    const fromPK = `${dto.fromType.toUpperCase()}#${dto.fromId}`;
    const total = destinations.reduce((sum, d) => sum + d.quantity, 0);
    const onHand =
      (await this.stockRepository.getStockLevel(fromPK, dto.productId))
        ?.quantity ?? 0;

    if (total > onHand) {
      throw new BadRequestException(
        `Cannot move ${total} of product ${dto.productId}: only ${onHand} on hand`,
      );
    }

    const transfers = [];
    for (const destination of destinations) {
      const items = [
        {
          productId: dto.productId,
          productName: dto.productName,
          quantity: destination.quantity,
        },
      ];
      const toPK = `${destination.toType.toUpperCase()}#${destination.toId}`;
      await this.stockService.transfer(fromPK, toPK, items);

      const transfer = {
        id: randomUUID(),
        type: TransferType.TRANSFER,
        fromType: dto.fromType,
        fromId: dto.fromId,
        toType: destination.toType,
        toId: destination.toId,
        items,
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
      transfers.push(transfer);
    }

    return { movedQuantity: total, remaining: onHand - total, transfers };
  }

  async deductStock(dto: DeductStockDto) {
    await this.productsService.assertStockable(dto.items.map((i) => i.productId));
    const containerId = await this.resolveContainerId(dto.containerId);
    await this.stockService.deduct(`CONTAINER#${containerId}`, dto.items);
    this.businessMetrics?.stockDeductions.inc();

    await this.repository.create({
      id: randomUUID(),
      type: TransferType.DEDUCT,
      fromType: LocationType.CONTAINER,
      fromId: containerId,
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
    await this.productsService.assertStockable(dto.items.map((i) => i.productId));
    const containerId = await this.resolveContainerId(dto.containerId);
    await this.stockService.receive(`CONTAINER#${containerId}`, dto.items);
    this.businessMetrics?.stockTransfers.inc({ type: 'restore' });

    await this.repository.create({
      id: randomUUID(),
      type: TransferType.RESTORE,
      fromType: null,
      fromId: null,
      toType: LocationType.CONTAINER,
      toId: containerId,
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

  async findAll(limit: number, cursor?: string) {
    return this.repository.findAll(limit, cursor);
  }

  async list(query: ListTransfersQueryDto) {
    return this.repository.findAll(query.limit || 20, query.cursor);
  }
}

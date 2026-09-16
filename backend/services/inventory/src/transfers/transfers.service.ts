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
import { ContainersRepository } from '../containers/containers.repository';
import { ProductsService } from '../products/products.service';
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
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly repository: TransfersRepository,
    private readonly stockService: StockService,
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

  async deductStock(dto: DeductStockDto) {
    await this.productsService.assertStockable(dto.items.map((i) => i.productId));
    const items = await this.onlyStockManaged(dto.items, 'stock deduction');
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
      notes: `Deal: ${dto.dealId}`,
      createdAt: new Date().toISOString(),
    });
  }

  async restoreStock(dto: RestoreStockDto) {
    await this.productsService.assertStockable(dto.items.map((i) => i.productId));
    // Symmetrical with deductStock: what was never deducted is never restored.
    const items = await this.onlyStockManaged(dto.items, 'stock restore');
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

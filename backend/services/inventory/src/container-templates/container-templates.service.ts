import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InventoryStatus,
  LocationType,
  ProductType,
  type ContainerTemplate,
  type ContainerTemplateDiff,
  type ContainerTemplateDiffLine,
  type ContainerTemplateFillResult,
  type ContainerTemplateItem,
  type JwtUser,
  type LocationSummary,
} from '@bitcrm/types';
import { ContainerTemplatesRepository } from './container-templates.repository';
import { ProductsService } from '../products/products.service';
import { LocationsRepository } from '../stock/locations.repository';
import { StockRepository } from '../stock/stock.repository';
import { TransfersService } from '../transfers/transfers.service';
import { type CreateTransferDto } from '../transfers/dto/create-transfer.dto';
import { type CreateContainerTemplateDto } from './dto/create-container-template.dto';
import { type UpdateContainerTemplateDto } from './dto/update-container-template.dto';
import { type FillContainerTemplateDto } from './dto/fill-container-template.dto';

type TemplateItemInput = { productId: string; quantity: number };

/**
 * Container templates — the "ideal loadout" of a technician's van. A template
 * is created once; any container is then compared against it (target / on
 * hand / missing per line) and filled from a warehouse in one transfer.
 * Nothing is ever deducted from a template. Templates are container
 * configuration and ride on the `containers` permission.
 */
@Injectable()
export class ContainerTemplatesService {
  constructor(
    private readonly repository: ContainerTemplatesRepository,
    private readonly productsService: ProductsService,
    private readonly locationsRepository: LocationsRepository,
    private readonly stockRepository: StockRepository,
    private readonly transfersService: TransfersService,
  ) {}

  /** In name order; active ones unless another status is asked for. */
  async list(status: InventoryStatus = InventoryStatus.ACTIVE): Promise<ContainerTemplate[]> {
    const templates = await this.repository.listAll();
    return templates.filter((t) => t.status === status);
  }

  async findById(id: string): Promise<ContainerTemplate> {
    const template = await this.repository.findById(id);
    if (!template) {
      throw new NotFoundException(`Container template "${id}" not found`);
    }
    return template;
  }

  async create(dto: CreateContainerTemplateDto): Promise<ContainerTemplate> {
    const name = dto.name.trim();
    const items = await this.resolveItems(dto.items);
    await this.assertNameFree(name);

    const now = new Date().toISOString();
    const template: ContainerTemplate = {
      id: randomUUID(),
      name,
      ...(dto.description && { description: dto.description }),
      items,
      status: InventoryStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(template);
    return template;
  }

  /** Partial; `description: null` clears it, `items` replaces every line. */
  async update(id: string, dto: UpdateContainerTemplateDto): Promise<ContainerTemplate> {
    const existing = await this.findById(id);

    const { description: _previous, ...rest } = existing;
    const description = dto.description === undefined ? existing.description : dto.description;
    const updated: ContainerTemplate = {
      ...rest,
      name: dto.name?.trim() ?? existing.name,
      ...(description && { description }),
      items: dto.items ? await this.resolveItems(dto.items) : existing.items,
      status: dto.status ?? existing.status,
      updatedAt: new Date().toISOString(),
    };

    if (updated.status === InventoryStatus.ACTIVE) {
      await this.assertNameFree(updated.name, id);
    }
    await this.repository.put(updated);
    return updated;
  }

  /** Archived, never deleted: a container may still name it in `templateId`. */
  async archive(id: string): Promise<ContainerTemplate> {
    const existing = await this.findById(id);
    const archived: ContainerTemplate = {
      ...existing,
      status: InventoryStatus.ARCHIVED,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.put(archived);
    return archived;
  }

  /**
   * The template against one container, line by line in template order —
   * and, given a warehouse, what it holds and what a fill would move. Products
   * the van carries that the template does not list are not lines: the diff
   * answers "what is missing", not "what is in the van".
   */
  async diff(id: string, containerId: string, warehouseId?: string): Promise<ContainerTemplateDiff> {
    const template = await this.findById(id);
    const container = await this.requireLocation(LocationType.CONTAINER, containerId);
    const warehouse = warehouseId
      ? await this.requireLocation(LocationType.WAREHOUSE, warehouseId)
      : undefined;

    const containerPK = `CONTAINER#${containerId}`;
    const warehousePK = warehouse ? `WAREHOUSE#${warehouse.id}` : undefined;
    const quantities = await this.stockRepository.getQuantities(
      warehousePK ? [containerPK, warehousePK] : [containerPK],
      template.items.map((item) => item.productId),
    );
    const held = (pk: string | undefined, productId: string) =>
      Math.max(0, (pk && quantities.get(pk)?.get(productId)) || 0);

    const lines = template.items.map((item): ContainerTemplateDiffLine => {
      const onHand = held(containerPK, item.productId);
      const missing = Math.max(0, item.quantity - onHand);
      const line: ContainerTemplateDiffLine = {
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        target: item.quantity,
        onHand,
        missing,
      };
      if (warehousePK) {
        line.available = held(warehousePK, item.productId);
        line.willMove = Math.min(missing, line.available);
      }
      return line;
    });

    return {
      templateId: template.id,
      templateName: template.name,
      containerId,
      containerName: container.name,
      ...(warehouse && { warehouseId: warehouse.id, warehouseName: warehouse.name }),
      lines,
      shortLineCount: lines.filter((line) => line.missing > 0).length,
      missingUnits: lines.reduce((sum, line) => sum + line.missing, 0),
    };
  }

  /**
   * "Fill from warehouse": everything the container is missing that the
   * warehouse holds moves in ONE transfer, through the ordinary transfer path
   * (stock rows, journal, `stock_moved` per item). Nothing movable is not an
   * error — the answer just says what is short. A line the transfer skipped
   * (its product is no longer stock-managed) did not move and stays short.
   */
  async fill(
    id: string,
    dto: FillContainerTemplateDto,
    user: JwtUser,
  ): Promise<ContainerTemplateFillResult> {
    const diff = await this.diff(id, dto.containerId, dto.warehouseId);
    const movable = diff.lines.filter((line) => (line.willMove ?? 0) > 0);
    if (movable.length === 0) {
      return { moved: [], short: diff.lines.filter((line) => line.missing > 0) };
    }

    const request: CreateTransferDto = {
      fromType: LocationType.WAREHOUSE,
      fromId: dto.warehouseId,
      toType: LocationType.CONTAINER,
      toId: dto.containerId,
      items: movable.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantity: line.willMove!,
      })),
      notes: dto.notes?.trim() || `Template: ${diff.templateName}`,
    };
    const transfer = await this.transfersService.createTransfer(request, user);

    const movedIds = new Set(transfer.items.map((item) => item.productId));
    const after = diff.lines.map((line) =>
      movedIds.has(line.productId) || line.willMove === undefined ? line : { ...line, willMove: 0 },
    );
    return {
      transfer,
      moved: after.filter((line) => movedIds.has(line.productId)),
      short: after.filter((line) => (line.willMove ?? 0) < line.missing),
    };
  }

  private async requireLocation(type: LocationType, id: string): Promise<LocationSummary> {
    const location = await this.locationsRepository.findLocation(type, id);
    if (!location) {
      const label = type === LocationType.WAREHOUSE ? 'Warehouse' : 'Container';
      throw new NotFoundException(`${label} "${id}" not found`);
    }
    return location;
  }

  /** Unique among the active templates, case-insensitively; `excludeId` is the one being edited. */
  private async assertNameFree(name: string, excludeId?: string): Promise<void> {
    const clash = (await this.repository.findByName(name)).find(
      (t) => t.id !== excludeId && t.status === InventoryStatus.ACTIVE,
    );
    if (clash) {
      throw new ConflictException(`A container template named "${clash.name}" already exists`);
    }
  }

  /**
   * Client `{ productId, quantity }` lines → stored lines, with the catalog's
   * name and SKU. Each product once; each must exist and be stock-managed —
   * a service or an untracked item could never be moved into the van.
   */
  private async resolveItems(items: TemplateItemInput[]): Promise<ContainerTemplateItem[]> {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.productId)) {
        throw new BadRequestException(`Product "${item.productId}" is listed more than once`);
      }
      seen.add(item.productId);
    }

    const resolved: ContainerTemplateItem[] = [];
    for (const item of items) {
      const product = await this.productsService.loadForStock(item.productId);
      if (!product) {
        throw new BadRequestException(`Product "${item.productId}" does not exist`);
      }
      if (product.type !== ProductType.PRODUCT || product.manageStock === false) {
        throw new BadRequestException(`"${product.name}" is not a stock-managed product`);
      }
      resolved.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
      });
    }
    return resolved;
  }
}

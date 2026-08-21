import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InventoryStatus,
  type ContainerTemplate,
  type ContainerTemplateDiff,
  type ContainerTemplateDiffLine,
  type ContainerTemplateItem,
} from '@bitcrm/types';
import { ContainerTemplatesRepository } from './container-templates.repository';
import { ContainersRepository } from '../containers/containers.repository';
import { ProductsRepository } from '../products/products.repository';
import { StockRepository } from '../stock/stock.repository';
import { CreateContainerTemplateDto } from './dto/create-container-template.dto';
import { UpdateContainerTemplateDto } from './dto/update-container-template.dto';

type TemplateItemInput = { productId: string; quantity: number };

@Injectable()
export class ContainerTemplatesService {
  constructor(
    private readonly repository: ContainerTemplatesRepository,
    private readonly containersRepository: ContainersRepository,
    private readonly productsRepository: ProductsRepository,
    private readonly stockRepository: StockRepository,
  ) {}

  async create(dto: CreateContainerTemplateDto): Promise<ContainerTemplate> {
    await this.assertNameIsFree(dto.name);
    const items = await this.resolveItems(dto.items);

    const now = new Date().toISOString();
    const template: ContainerTemplate = {
      id: randomUUID(),
      name: dto.name.trim(),
      ...(dto.description && { description: dto.description }),
      items,
      status: InventoryStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(template);
    return template;
  }

  async findAll(): Promise<ContainerTemplate[]> {
    return this.repository.findAll();
  }

  async findById(id: string): Promise<ContainerTemplate> {
    const template = await this.repository.findById(id);
    if (!template) {
      throw new NotFoundException(`Container template "${id}" not found`);
    }
    return template;
  }

  async update(
    id: string,
    dto: UpdateContainerTemplateDto,
  ): Promise<ContainerTemplate> {
    const existing = await this.findById(id);

    if (dto.name && dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameIsFree(dto.name);
    }

    const attrs: Partial<ContainerTemplate> = {
      ...(dto.name && { name: dto.name.trim() }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.items && { items: await this.resolveItems(dto.items) }),
    };

    return this.repository.update(id, attrs);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.repository.remove(id);
  }

  /**
   * Target-vs-actual for one container. Products the technician carries but the
   * template does not list are deliberately absent: the template answers "what is
   * missing", not "what is in the van".
   */
  async diffForContainer(containerId: string): Promise<ContainerTemplateDiff> {
    const container = await this.containersRepository.findById(containerId);
    if (!container) {
      throw new NotFoundException(`Container "${containerId}" not found`);
    }
    if (!container.templateId) {
      throw new NotFoundException(
        `Container "${containerId}" has no template assigned`,
      );
    }

    const template = await this.findById(container.templateId);
    const stock = await this.stockRepository.getStockLevels(
      `CONTAINER#${containerId}`,
    );
    const onHandByProduct = new Map(
      stock.map((item) => [item.productId, item.quantity]),
    );

    const lines: ContainerTemplateDiffLine[] = template.items.map((item) => {
      const onHand = onHandByProduct.get(item.productId) ?? 0;
      return {
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        target: item.quantity,
        onHand,
        missing: Math.max(0, item.quantity - onHand),
      };
    });

    return {
      containerId,
      templateId: template.id,
      templateName: template.name,
      lines,
      shortLineCount: lines.filter((line) => line.missing > 0).length,
    };
  }

  private async assertNameIsFree(name: string): Promise<void> {
    const clash = await this.repository.findByName(name);
    if (clash) {
      throw new ConflictException(
        `A container template named "${name.trim()}" already exists`,
      );
    }
  }

  /**
   * Turns client `{productId, quantity}` lines into stored lines, stamping the
   * product's current name and SKU so the template renders without a per-line
   * lookup — and still reads if the product is archived later.
   */
  private async resolveItems(
    items: TemplateItemInput[],
  ): Promise<ContainerTemplateItem[]> {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.productId)) {
        throw new BadRequestException(
          `Product "${item.productId}" is listed more than once`,
        );
      }
      seen.add(item.productId);
    }

    return Promise.all(
      items.map(async (item) => {
        const product = await this.productsRepository.findById(item.productId);
        if (!product) {
          throw new BadRequestException(
            `Product "${item.productId}" does not exist`,
          );
        }
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: item.quantity,
        };
      }),
    );
  }
}

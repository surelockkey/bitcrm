import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  SnsPublisherService,
  RedisService,
  cachedCount,
  countCacheKey,
} from '@bitcrm/shared';
import { randomUUID } from 'crypto';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import {
  type Container,
  type StockItem,
  type JwtUser,
  type ListCount,
  InventoryStatus,
} from '@bitcrm/types';
import { ContainersRepository } from './containers.repository';
import { StockRepository } from '../stock/stock.repository';
import { ContainerAssignmentResolver } from '../user-containers/container-assignment.resolver';
import { ContainerTemplatesRepository } from '../container-templates/container-templates.repository';
import { CreateContainerDto } from './dto/create-container.dto';
import { ListContainersQueryDto } from './dto/list-containers-query.dto';
import { UpdateContainerDto } from './dto/update-container.dto';

/** How long a list count stays good enough. Matches the deals tab counts. */
const COUNT_TTL_SECONDS = 30;

/**
 * The list filters, applied in memory to the one container a technician is
 * scoped to — the same question the index Query answers for everyone else,
 * so `status=archived` never hands an active van back with a count of one.
 */
export function containerMatchesFilters(
  container: Container,
  filters: Pick<ListContainersQueryDto, 'search' | 'status'>,
): boolean {
  if (filters.status && container.status !== filters.status) return false;
  const term = filters.search?.trim().toLowerCase();
  if (term && !container.name.toLowerCase().includes(term)) return false;
  return true;
}

@Injectable()
export class ContainersService {
  private readonly logger = new Logger(ContainersService.name);

  constructor(
    private readonly repository: ContainersRepository,
    private readonly stockRepository: StockRepository,
    private readonly assignments: ContainerAssignmentResolver,
    private readonly templates: ContainerTemplatesRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * `technicianId` is still accepted — the legacy one-technician link the
   * resolver falls back to — but no longer exclusive: a van may have many
   * users now, and who works from it is `PUT /user-containers/:userId`.
   */
  async create(dto: CreateContainerDto): Promise<Container> {
    if (dto.templateId) await this.assertTemplateUsable(dto.templateId);

    const now = new Date().toISOString();
    const container: Container = {
      id: randomUUID(),
      name: dto.name,
      description: dto.description,
      technicianId: dto.technicianId,
      technicianName: dto.technicianName,
      department: dto.department,
      ...(dto.templateId && { templateId: dto.templateId }),
      status: InventoryStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(container);
    publishInventoryEvent(this.snsPublisher, this.logger, 'container.created', {
      containerId: container.id,
    });
    return container;
  }

  /** The container the calling user works from, if any. */
  async getMyContainer(user: JwtUser): Promise<Container> {
    const existing = await this.ownContainer(user);
    if (existing) return existing;
    throw new NotFoundException(
      'No container assigned. Ask a manager to assign you one.',
    );
  }

  /** The one container an `assigned_only` caller sees: the one they are assigned to. */
  private async ownContainer(user: JwtUser): Promise<Container | null> {
    const containerId = await this.assignments.containerIdForUser(user.id);
    return containerId ? this.repository.findById(containerId) : null;
  }

  async findById(id: string): Promise<Container> {
    const container = await this.repository.findById(id);
    if (!container) {
      throw new NotFoundException(`Container "${id}" not found`);
    }
    return container;
  }

  async update(id: string, dto: UpdateContainerDto): Promise<Container> {
    const existing = await this.findById(id);

    const attrs: Partial<Record<keyof UpdateContainerDto, unknown>> = { ...dto };
    // `null` clears the template (the repository REMOVEs it). A different one
    // must be usable; the one the van already has is re-saved as it is, even
    // if it was archived since — the edit form sends every field back.
    if (typeof dto.templateId === 'string' && dto.templateId !== existing.templateId) {
      await this.assertTemplateUsable(dto.templateId);
    }
    if (dto.technicianId === null) {
      // Unassigning always clears the denormalized name too.
      attrs.technicianName = null;
    }

    const container = await this.repository.update(
      id,
      attrs as Partial<Container>,
    );
    publishInventoryEvent(this.snsPublisher, this.logger, 'container.updated', {
      containerId: id,
    });
    return container;
  }

  async findAll(limit: number, cursor?: string) {
    return this.repository.findAll(limit, cursor);
  }

  async list(query: ListContainersQueryDto, user?: JwtUser, dataScope?: string) {
    // Apply data scope filtering
    if (dataScope === 'assigned_only' && user) {
      const container = await this.ownContainer(user);
      return {
        items: container && containerMatchesFilters(container, query) ? [container] : [],
        nextCursor: undefined,
      };
    }

    const department =
      dataScope === 'department' && user ? user.department : query.department;

    return this.repository.findAll(query.limit || 20, query.cursor, {
      department,
      search: query.search,
      status: query.status,
    });
  }

  /**
   * How many containers the list holds — the number behind "Page 2 of 7".
   *
   * It applies the same data scope the list does, or a technician would be
   * told there are forty pages of a list that shows them their own van.
   */
  async count(
    query: ListContainersQueryDto,
    user?: JwtUser,
    dataScope?: string,
  ): Promise<ListCount> {
    // Scoped to their own container: one row at most, and no count to take.
    if (dataScope === 'assigned_only' && user) {
      const container = await this.ownContainer(user);
      return {
        total: container && containerMatchesFilters(container, query) ? 1 : 0,
        atLeast: false,
      };
    }

    const department =
      dataScope === 'department' && user ? user.department : query.department;
    const filters = { department, search: query.search, status: query.status };

    const take = () => this.repository.countAll(filters);
    if (!this.redis) return take();
    return cachedCount(
      this.redis.client,
      countCacheKey('containers', filters),
      COUNT_TTL_SECONDS,
      take,
    );
  }

  /** A container may only be pointed at a template that exists and is active. */
  private async assertTemplateUsable(templateId: string): Promise<void> {
    const template = await this.templates.findById(templateId);
    if (!template) {
      throw new NotFoundException(`Container template "${templateId}" not found`);
    }
    if (template.status !== InventoryStatus.ACTIVE) {
      throw new BadRequestException(`Container template "${template.name}" is archived`);
    }
  }

  async getStock(containerId: string): Promise<StockItem[]> {
    await this.findById(containerId);
    return this.stockRepository.getStockLevels(`CONTAINER#${containerId}`);
  }
}

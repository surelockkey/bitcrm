import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import { randomUUID } from 'crypto';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import {
  type Container,
  type StockItem,
  type JwtUser,
  InventoryStatus,
} from '@bitcrm/types';
import { ContainersRepository } from './containers.repository';
import { StockRepository } from '../stock/stock.repository';
import { CreateContainerDto } from './dto/create-container.dto';
import { ListContainersQueryDto } from './dto/list-containers-query.dto';
import { UpdateContainerDto } from './dto/update-container.dto';

@Injectable()
export class ContainersService {
  private readonly logger = new Logger(ContainersService.name);

  constructor(
    private readonly repository: ContainersRepository,
    private readonly stockRepository: StockRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  async create(dto: CreateContainerDto): Promise<Container> {
    if (dto.technicianId) {
      await this.assertTechnicianFree(dto.technicianId);
    }

    const now = new Date().toISOString();
    const container: Container = {
      id: randomUUID(),
      name: dto.name,
      description: dto.description,
      technicianId: dto.technicianId,
      technicianName: dto.technicianName,
      department: dto.department,
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

  /** The container assigned to the calling technician, if any. */
  async getMyContainer(user: JwtUser): Promise<Container> {
    const existing = await this.repository.findByTechnicianId(user.id);
    if (existing) return existing;
    throw new NotFoundException(
      'No container assigned. Ask a manager to assign you one.',
    );
  }

  async findById(id: string): Promise<Container> {
    const container = await this.repository.findById(id);
    if (!container) {
      throw new NotFoundException(`Container "${id}" not found`);
    }
    return container;
  }

  async update(id: string, dto: UpdateContainerDto): Promise<Container> {
    await this.findById(id);

    const attrs: Partial<Record<keyof UpdateContainerDto, unknown>> = { ...dto };
    if (dto.technicianId) {
      await this.assertTechnicianFree(dto.technicianId, id);
    } else if (dto.technicianId === null) {
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
      const container = await this.repository.findByTechnicianId(user.id);
      return {
        items: container ? [container] : [],
        nextCursor: undefined,
      };
    }

    const department =
      dataScope === 'department' && user ? user.department : query.department;

    return this.repository.findAll(query.limit || 20, query.cursor, {
      department,
    });
  }

  async getStock(containerId: string): Promise<StockItem[]> {
    await this.findById(containerId);
    return this.stockRepository.getStockLevels(`CONTAINER#${containerId}`);
  }

  /** A technician can be assigned to at most one container. */
  private async assertTechnicianFree(
    technicianId: string,
    excludeContainerId?: string,
  ): Promise<void> {
    const existing = await this.repository.findByTechnicianId(technicianId);
    if (existing && existing.id !== excludeContainerId) {
      throw new BadRequestException(
        `This technician is already assigned to "${existing.name}". Unassign them there first.`,
      );
    }
  }
}

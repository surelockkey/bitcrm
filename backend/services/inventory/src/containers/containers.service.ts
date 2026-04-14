import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  type Container,
  type StockItem,
  type JwtUser,
  InventoryStatus,
} from '@bitcrm/types';
import { ContainersRepository } from './containers.repository';
import { StockRepository } from '../stock/stock.repository';
import { EnsureContainerDto } from './dto/ensure-container.dto';
import { ListContainersQueryDto } from './dto/list-containers-query.dto';

@Injectable()
export class ContainersService {
  constructor(
    private readonly repository: ContainersRepository,
    private readonly stockRepository: StockRepository,
  ) {}

  async ensureContainer(dto: EnsureContainerDto): Promise<Container> {
    const existing = await this.repository.findByTechnicianId(dto.technicianId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const container: Container = {
      id: randomUUID(),
      technicianId: dto.technicianId,
      technicianName: dto.technicianName,
      department: dto.department,
      status: InventoryStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(container);
    return container;
  }

  async getMyContainer(user: JwtUser): Promise<Container> {
    const existing = await this.repository.findByTechnicianId(user.id);
    if (existing) return existing;

    // Only technicians get containers via lazy creation
    if (user.roleId !== 'role-technician') {
      throw new NotFoundException('No container found. Containers are only for technicians.');
    }

    return this.ensureContainer({
      technicianId: user.id,
      technicianName: user.email,
      department: user.department,
    });
  }

  async findById(id: string): Promise<Container> {
    const container = await this.repository.findById(id);
    if (!container) {
      throw new NotFoundException(`Container "${id}" not found`);
    }
    return container;
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
}

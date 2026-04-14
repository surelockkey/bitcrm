import { randomUUID } from 'crypto';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { type Role, RESOURCE_REGISTRY } from '@bitcrm/types';
import { RolesRepository } from './roles.repository';
import { RolesCacheService } from './roles-cache.service';
import { UsersRepository } from '../users/users.repository';
import { DEFAULT_ROLES } from './constants/default-roles';

@Injectable()
export class RolesService implements OnModuleInit {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly rolesRepository: RolesRepository,
    private readonly rolesCache: RolesCacheService,
    private readonly usersRepository: UsersRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seedDefaults();
      this.logger.log('Default roles seeded');
    } catch (error) {
      this.logger.error('Failed to seed default roles', error);
    }
  }

  async create(dto: {
    name: string;
    description?: string;
    permissions: Record<string, Record<string, boolean>>;
    dataScope: Record<string, string>;
    dealStageTransitions: string[];
    priority: number;
  }): Promise<Role> {
    // Validate name uniqueness
    const existing = await this.rolesRepository.findByName(dto.name);
    if (existing) {
      throw new ConflictException(`Role with name "${dto.name}" already exists`);
    }

    // Validate permissions against RESOURCE_REGISTRY
    for (const resource of Object.keys(dto.permissions)) {
      if (!(resource in RESOURCE_REGISTRY)) {
        throw new BadRequestException(`Unknown resource: ${resource}`);
      }
    }

    const now = new Date().toISOString();
    const role: Role = {
      id: randomUUID(),
      name: dto.name,
      description: dto.description,
      permissions: dto.permissions,
      dataScope: dto.dataScope as Role['dataScope'],
      dealStageTransitions: dto.dealStageTransitions,
      isSystem: false,
      priority: dto.priority,
      createdAt: now,
      updatedAt: now,
    };

    await this.rolesRepository.create(role);
    return role;
  }

  async update(id: string, dto: Partial<Role>): Promise<Role> {
    const existing = await this.rolesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Role with id "${id}" not found`);
    }

    if (existing.isSystem && existing.name === 'Super Admin') {
      throw new ForbiddenException('Cannot modify the Super Admin role');
    }

    const updated = await this.rolesRepository.update(id, dto);

    // Invalidate role cache
    await this.rolesCache.invalidateRole(id);

    // Invalidate all users with this role
    const { items: users } = await this.usersRepository.findByRole(id, 1000);
    const userIds = users.map((u: { id: string }) => u.id);
    await this.rolesCache.invalidateAllUsersWithRole(id, userIds);

    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.rolesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Role with id "${id}" not found`);
    }

    if (existing.isSystem) {
      throw new ForbiddenException('Cannot delete a system role');
    }

    // Check for assigned users
    const { items: users } = await this.usersRepository.findByRole(id, 1);
    if (users.length > 0) {
      throw new ConflictException('Cannot delete role with assigned users');
    }

    await this.rolesRepository.delete(id);
  }

  async findById(id: string): Promise<Role> {
    const role = await this.rolesRepository.findById(id);
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return role;
  }

  async findAll(): Promise<Role[]> {
    return this.rolesRepository.findAll();
  }

  async seedDefaults(): Promise<void> {
    for (const roleDef of DEFAULT_ROLES) {
      const existing = await this.rolesRepository.findByName(roleDef.name);
      if (existing) continue;

      const now = new Date().toISOString();
      const role: Role = {
        ...roleDef,
        createdAt: now,
        updatedAt: now,
      };

      await this.rolesRepository.create(role);
    }
  }
}

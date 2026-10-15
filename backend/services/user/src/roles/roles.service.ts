import { randomUUID } from 'crypto';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { type JwtUser, type Role, RESOURCE_REGISTRY } from '@bitcrm/types';
import { RolesRepository } from './roles.repository';
import { RolesCacheService } from './roles-cache.service';
import { UsersRepository } from '../users/users.repository';
import { DEFAULT_ROLES } from './constants/default-roles';
import { reconcileRolePermissions } from './reconcile-role-permissions';
import { AdminAuditService } from '../audit/admin-audit.service';
import { diffFields } from '../audit/audit-diff';

/** The parts of a role its audit line compares. */
const AUDITED_ROLE_FIELDS = ['name', 'description', 'priority', 'permissions', 'dataScope', 'dealStageTransitions'] as const;

/**
 * In-process copy of a role, in front of the shared Redis one. Short on
 * purpose: a write on another task reaches this one only when it expires, so
 * this bounds how stale a peer task's role can be (Redis itself is deleted on
 * every write). The same task's own writes drop it at once.
 */
const ROLE_L1_TTL_MS = 10_000;

@Injectable()
export class RolesService implements OnModuleInit {
  private readonly logger = new Logger(RolesService.name);
  private readonly roleL1 = new Map<string, { role: Role; expiresAt: number }>();
  /** Bumped by every local invalidation, so a load it overtakes cannot refill L1. */
  private readonly roleL1Gen = new Map<string, number>();

  constructor(
    private readonly rolesRepository: RolesRepository,
    private readonly rolesCache: RolesCacheService,
    private readonly usersRepository: UsersRepository,
    @Optional() private readonly audit?: AdminAuditService,
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
  }, caller?: JwtUser): Promise<Role> {
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
    await this.forgetRole(role.id);
    if (caller) {
      await this.audit?.record(
        caller,
        'role.created',
        { type: 'role', id: role.id, label: role.name },
        diffFields({}, role, AUDITED_ROLE_FIELDS),
      );
    }
    return role;
  }

  async update(id: string, dto: Partial<Role>, caller?: JwtUser): Promise<Role> {
    const existing = await this.rolesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Role with id "${id}" not found`);
    }

    if (existing.isSystem && existing.name === 'Super Admin') {
      throw new ForbiddenException('Cannot modify the Super Admin role');
    }

    const updated = await this.rolesRepository.update(id, dto);
    const changes = diffFields(existing, updated, AUDITED_ROLE_FIELDS);
    if (caller && changes) {
      await this.audit?.record(caller, 'role.updated', { type: 'role', id, label: existing.name }, changes);
    }

    // Invalidate role cache (the resolved matrix and the cached role row)
    await this.forgetRole(id);

    // Invalidate all users with this role — every page of them: the cache
    // lives for minutes, so a user past a page cap would keep the old matrix.
    const users = await this.usersRepository.findByRoleId(id);
    await this.rolesCache.invalidateAllUsersWithRole(
      id,
      users.map((u) => u.id),
    );

    return updated;
  }

  async delete(id: string, caller?: JwtUser): Promise<void> {
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
    await this.forgetRole(id);
    if (caller) await this.audit?.record(caller, 'role.deleted', { type: 'role', id, label: existing.name });
  }

  /**
   * Read-through: in-process (≤ 10 s) → Redis `role:entity:<id>` (5 min,
   * generation-checked, see `RolesCacheService`) → DynamoDB. A Redis failure
   * only costs the cache (nothing is written then); a missing role is never
   * cached. A load that an invalidation overtakes writes nothing usable: its
   * Redis entry carries the old generation, and its in-process copy is
   * dropped by the local generation check. Writes (`update`, `delete`) read
   * the table directly, never this.
   */
  async findById(id: string): Promise<Role> {
    const local = this.roleL1.get(id);
    if (local && local.expiresAt > Date.now()) return local.role;

    const localGen = this.roleL1Gen.get(id) ?? 0;
    const read = await this.rolesCache.readRole(id).catch((err: Error) => {
      this.logger.warn(`role cache read failed for ${id}: ${err?.message}`);
      return null;
    });
    let role = read?.role ?? null;
    if (!role) {
      role = await this.rolesRepository.findById(id);
      if (!role) {
        throw new NotFoundException(`Role ${id} not found`);
      }
      if (read) {
        await this.rolesCache.writeRole(role, read.gen).catch((err: Error) =>
          this.logger.warn(`role cache write failed for ${id}: ${err?.message}`),
        );
      }
    }
    if ((this.roleL1Gen.get(id) ?? 0) === localGen) {
      this.roleL1.set(id, { role, expiresAt: Date.now() + ROLE_L1_TTL_MS });
    }
    return role;
  }

  /**
   * Drops every cached copy of a role: this task's (and disowns its loads in
   * flight), and the shared Redis keys with a generation bump.
   */
  private async forgetRole(id: string): Promise<void> {
    this.roleL1.delete(id);
    this.roleL1Gen.set(id, (this.roleL1Gen.get(id) ?? 0) + 1);
    await this.rolesCache.invalidateRole(id);
  }

  async findAll(): Promise<Role[]> {
    return this.rolesRepository.findAll();
  }

  async seedDefaults(): Promise<void> {
    for (const roleDef of DEFAULT_ROLES) {
      const existing = await this.rolesRepository.findByName(roleDef.name);

      if (!existing) {
        const now = new Date().toISOString();
        const role: Role = {
          ...roleDef,
          createdAt: now,
          updatedAt: now,
        };
        await this.rolesRepository.create(role);
        await this.forgetRole(role.id);
        continue;
      }

      // Self-heal: backfill any registry resources added after this role was
      // seeded (e.g. technicians/skills/commission), without clobbering edits.
      const { permissions, dataScope, changed } = reconcileRolePermissions(
        existing,
        roleDef,
      );
      if (changed) {
        await this.rolesRepository.update(existing.id, { permissions, dataScope });
        await this.forgetRole(existing.id);
        const users = await this.usersRepository.findByRoleId(existing.id);
        await this.rolesCache.invalidateAllUsersWithRole(
          existing.id,
          users.map((u) => u.id),
        );
        this.logger.log(
          `Reconciled new permission resources into role "${existing.name}"`,
        );
      }
    }
  }
}

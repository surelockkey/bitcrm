import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  InventoryLogAction,
  InventoryStatus,
  LocationType,
  UserContainerAccess,
  type Container,
  type JwtUser,
  type UserContainer,
} from '@bitcrm/types';
import { UserContainersRepository } from './user-containers.repository';
import { ContainersRepository } from '../containers/containers.repository';
import { InventoryLogService } from '../inventory-log/inventory-log.service';
import { AssignUserContainerDto } from './dto/assign-user-container.dto';

/** Where a user worked from before an assignment: their row, else the legacy link. */
interface PreviousAssignment {
  access: UserContainerAccess;
  containerId?: string;
  containerName?: string;
}

/**
 * Workiz "User containers": each user has exactly one current container,
 * "All locations" or "No access"; a container may be shared by many users.
 * Reassigning a van (a tech takes another tech's) is one PUT, and every change
 * of access or container is a `container_assigned` line in the inventory log.
 */
@Injectable()
export class UserContainersService {
  constructor(
    private readonly repository: UserContainersRepository,
    private readonly containers: ContainersRepository,
    @Optional() private readonly inventoryLog?: InventoryLogService,
  ) {}

  list(): Promise<UserContainer[]> {
    return this.repository.listAll();
  }

  async findByUser(userId: string): Promise<UserContainer> {
    const row = await this.repository.findByUser(userId);
    if (!row) {
      throw new NotFoundException(`User "${userId}" has no container assignment`);
    }
    return row;
  }

  /** The caller's own assignment. */
  async mine(user: JwtUser): Promise<UserContainer> {
    const row = await this.repository.findByUser(user.id);
    if (!row) {
      throw new NotFoundException('No container assignment. Ask a manager to assign you one.');
    }
    return row;
  }

  /** The users whose one container is this one. */
  async listByContainer(containerId: string): Promise<UserContainer[]> {
    const container = await this.containers.findById(containerId);
    if (!container) {
      throw new NotFoundException(`Container "${containerId}" not found`);
    }
    return this.repository.listByContainer(containerId);
  }

  /**
   * Replace a user's assignment. A container must exist and be active; its
   * name is snapshotted on the row. `limited` only means something with a
   * container and is stored `false` otherwise.
   */
  async assign(userId: string, dto: AssignUserContainerDto, actor: JwtUser): Promise<UserContainer> {
    let container: Container | undefined;
    if (dto.access === UserContainerAccess.CONTAINER) {
      container = await this.requireActiveContainer(dto.containerId);
    }

    const previous = await this.previousAssignment(userId);

    const row: UserContainer = {
      userId,
      userName: dto.userName.trim(),
      access: dto.access,
      ...(container && { containerId: container.id, containerName: container.name }),
      limited: container ? dto.limited === true : false,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.id,
      updatedByName: actor.email,
    };
    await this.repository.put(row);

    if (previous.access !== row.access || previous.containerId !== row.containerId) {
      await this.inventoryLog?.record({
        action: InventoryLogAction.CONTAINER_ASSIGNED,
        subjectUserId: userId,
        subjectUserName: row.userName,
        access: row.access,
        ...(previous.containerId && {
          fromType: LocationType.CONTAINER,
          fromId: previous.containerId,
          fromName: previous.containerName ?? previous.containerId,
        }),
        ...(row.containerId && {
          toType: LocationType.CONTAINER,
          toId: row.containerId,
          toName: row.containerName,
        }),
        userId: actor.id,
        userName: actor.email,
      });
    }
    return row;
  }

  private async requireActiveContainer(containerId: string | undefined): Promise<Container> {
    if (!containerId) {
      throw new BadRequestException('`containerId` is required when access is "container"');
    }
    const container = await this.containers.findById(containerId);
    if (!container) {
      throw new NotFoundException(`Container "${containerId}" not found`);
    }
    if (container.status === InventoryStatus.ARCHIVED) {
      throw new BadRequestException(`Container "${container.name}" is archived`);
    }
    return container;
  }

  /**
   * The row decides; with none yet, the container that still names the user
   * as its technician (dev, until `backfill:user-containers` has run) is where
   * they worked from — so the first explicit assignment logs the real move.
   */
  private async previousAssignment(userId: string): Promise<PreviousAssignment> {
    const row = await this.repository.findByUser(userId);
    if (row) return row;
    const legacy = await this.containers.findByTechnicianId(userId);
    return legacy
      ? { access: UserContainerAccess.CONTAINER, containerId: legacy.id, containerName: legacy.name }
      : { access: UserContainerAccess.NONE };
  }
}

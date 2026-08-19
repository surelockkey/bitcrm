import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CALL_GROUP_LIMITS,
  type CallGroup,
  type CallGroupMember,
  type CallGroupWithMembers,
  type ResolvedCallGroupMember,
} from '@bitcrm/types';
import { CallGroupsRepository } from './call-groups.repository';
import { PresenceService } from '../presence/presence.service';
import {
  UserDirectoryService,
  type DirectoryUser,
} from '../common/user-directory.service';
import {
  type CallGroupMemberDto,
  type CreateCallGroupDto,
  type UpdateCallGroupDto,
} from './dto/call-group.dto';

/** One leg to ring: a softphone identity or a plain number. */
export interface RingTarget {
  userId: string;
  channel: 'softphone' | 'personal';
  /** `client:<userId>` for a softphone, E.164 for a personal number. */
  endpoint: string;
}

@Injectable()
export class CallGroupsService {
  private readonly logger = new Logger(CallGroupsService.name);

  constructor(
    private readonly repository: CallGroupsRepository,
    private readonly directory: UserDirectoryService,
    private readonly presence: PresenceService,
  ) {}

  /* ------------------------------------------------------------ reading */

  async list(): Promise<CallGroupWithMembers[]> {
    const groups = await this.repository.listAll();
    const resolved = await this.resolveMany(groups);
    return resolved.sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<CallGroupWithMembers> {
    const group = await this.repository.get(id);
    if (!group) throw new NotFoundException(`Call group ${id} not found`);
    const [withMembers] = await this.resolveMany([group]);
    return withMembers;
  }

  /**
   * Names, numbers and softphone status are read fresh every time rather than
   * stored on the member: a rename, a new personal number or someone going
   * offline must show through without anybody re-saving the group.
   */
  private async resolveMany(
    groups: CallGroup[],
  ): Promise<CallGroupWithMembers[]> {
    const [everyone, onlineIds] = await Promise.all([
      this.directory.list(),
      this.presence.listOnline(),
    ]);
    const byId = new Map(everyone.map((u) => [u.id, u]));
    const online = new Set(onlineIds);

    return groups.map((group) => ({
      ...group,
      members: [...(group.members ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((member): ResolvedCallGroupMember => {
          const user = byId.get(member.userId);
          return {
            ...member,
            name: user?.name,
            roleId: user?.roleId,
            phone: user?.phone,
            softphoneOnline: online.has(member.userId),
            missing: !user,
          };
        }),
    }));
  }

  /**
   * The stored group, or null. The runner needs this mid-call: a group that
   * has been deleted must fall back to ringing everyone, not throw inside a
   * webhook Twilio is waiting on.
   */
  async findRaw(id: string): Promise<CallGroup | null> {
    return this.repository.get(id);
  }

  /* ------------------------------------------------------------ writing */

  async create(dto: CreateCallGroupDto, caller: { id: string }): Promise<CallGroupWithMembers> {
    const name = dto.name.trim();
    await this.assertNameAvailable(name);

    const members = await this.validateMembers(dto.members ?? []);
    const active = dto.active ?? true;
    this.assertActivatable(active, members);

    const now = new Date().toISOString();
    const group: CallGroup = {
      id: randomUUID(),
      name,
      description: dto.description?.trim() || undefined,
      type: dto.type ?? 'ring_all',
      members,
      active,
      ringSeconds: dto.ringSeconds ?? CALL_GROUP_LIMITS.defaultRingSeconds,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(group);
    this.logger.log(`Call group "${group.name}" created with ${members.length} member(s)`);
    return this.findById(group.id);
  }

  async update(
    id: string,
    dto: UpdateCallGroupDto,
    caller: { id: string },
  ): Promise<CallGroupWithMembers> {
    const existing = await this.mustGet(id);
    const name = dto.name?.trim() ?? existing.name;
    if (dto.name !== undefined) await this.assertNameAvailable(name, id);

    const active = dto.active ?? existing.active;
    this.assertActivatable(active, existing.members ?? []);

    await this.repository.put({
      ...existing,
      name,
      description:
        dto.description === undefined
          ? existing.description
          : dto.description.trim() || undefined,
      type: dto.type ?? existing.type,
      active,
      ringSeconds: dto.ringSeconds ?? existing.ringSeconds,
      updatedBy: caller.id,
      updatedAt: new Date().toISOString(),
    });
    return this.findById(id);
  }

  async setMembers(
    id: string,
    members: CallGroupMemberDto[],
    caller: { id: string },
  ): Promise<CallGroupWithMembers> {
    const existing = await this.mustGet(id);
    const validated = await this.validateMembers(members);
    this.assertActivatable(existing.active, validated);

    await this.repository.put({
      ...existing,
      members: validated,
      updatedBy: caller.id,
      updatedAt: new Date().toISOString(),
    });
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.mustGet(id);
    await this.repository.delete(id);
  }

  /* --------------------------------------------------------- validation */

  private async mustGet(id: string): Promise<CallGroup> {
    const group = await this.repository.get(id);
    if (!group) throw new NotFoundException(`Call group ${id} not found`);
    return group;
  }

  /**
   * Two groups called "Dispatch" is an operational trap the moment a phone
   * number points at one of them.
   */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const clash = (await this.repository.listAll()).find(
      (g) => g.id !== excludeId && g.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A call group named "${clash.name}" already exists`);
    }
  }

  /** A live group that can never answer is worse than a paused one. */
  private assertActivatable(active: boolean, members: CallGroupMember[]): void {
    if (active && members.filter((m) => m.enabled).length === 0) {
      throw new BadRequestException(
        'A group with nobody to ring cannot be active — add a member or pause the group',
      );
    }
  }

  /**
   * Membership is checked against the live directory, not taken on trust: a
   * personal-number channel for somebody with no number on file would ring
   * nothing while the settings page claimed otherwise, and the failure would
   * only ever surface as a missed call.
   */
  private async validateMembers(
    members: CallGroupMemberDto[],
  ): Promise<CallGroupMember[]> {
    if (members.length > CALL_GROUP_LIMITS.maxMembers) {
      throw new BadRequestException(
        `A group can hold at most ${CALL_GROUP_LIMITS.maxMembers} members — every ` +
          'phone rung in parallel is a billed call',
      );
    }

    const seen = new Set<string>();
    for (const member of members) {
      if (seen.has(member.userId)) {
        throw new BadRequestException('The same person cannot be added twice');
      }
      seen.add(member.userId);
    }

    const byId = new Map((await this.directory.list()).map((u) => [u.id, u]));
    return members.map((member, index) => {
      const user = byId.get(member.userId);
      if (!user) {
        throw new BadRequestException(
          `${member.userId} is not an active user and cannot be a member`,
        );
      }
      if (member.channel !== 'softphone' && !user.phone) {
        throw new BadRequestException(
          `${user.name} has no personal number on file — ring their softphone, ` +
            'or add a number to their profile first',
        );
      }
      return {
        userId: member.userId,
        channel: member.channel,
        order: member.order ?? index,
        enabled: member.enabled ?? true,
      };
    });
  }

  /* ------------------------------------------------------------ routing */

  /**
   * The legs an inbound call should ring for this group — the seam routing
   * plugs into (see the plan's P1). Nothing calls it yet.
   *
   * Drops what can't be reached rather than failing: a disabled member, a user
   * who has since been deactivated, or a softphone whose owner is offline. A
   * personal number is kept regardless of presence — being away from the desk
   * is exactly when it earns its place.
   */
  async resolveTargets(group: CallGroup): Promise<RingTarget[]> {
    const [everyone, onlineIds] = await Promise.all([
      this.directory.list(),
      this.presence.listOnline(),
    ]);
    const byId = new Map(everyone.map((u: DirectoryUser) => [u.id, u]));
    const online = new Set(onlineIds);

    const targets: RingTarget[] = [];
    for (const member of [...(group.members ?? [])].sort((a, b) => a.order - b.order)) {
      if (!member.enabled) continue;
      const user = byId.get(member.userId);
      if (!user) continue;

      if (member.channel !== 'personal' && online.has(member.userId)) {
        targets.push({
          userId: member.userId,
          channel: 'softphone',
          endpoint: `client:${member.userId}`,
        });
      }
      if (member.channel !== 'softphone' && user.phone) {
        targets.push({
          userId: member.userId,
          channel: 'personal',
          endpoint: user.phone,
        });
      }
    }
    return targets;
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CALL_GROUP_LIMITS,
  type CallDevice,
  type CallGroup,
  type CallGroupDeviceMember,
  type CallGroupMember,
  type CallGroupWithMembers,
  type ResolvedCallGroupDeviceMember,
  type ResolvedCallGroupMember,
} from '@bitcrm/types';
import { CallGroupsRepository } from './call-groups.repository';
import { PresenceService } from '../presence/presence.service';
import {
  UserDirectoryService,
  type DirectoryUser,
} from '../common/user-directory.service';
import { CallDevicesService } from '../call-devices/call-devices.service';
import {
  type CallGroupDeviceMemberDto,
  type CallGroupMemberDto,
  type CreateCallGroupDto,
  type UpdateCallGroupDto,
} from './dto/call-group.dto';

/**
 * One leg to ring: a softphone identity, somebody's own number, a device's
 * number or SIP address, or an outside number a step forwards to.
 */
export interface RingTarget {
  /** The teammate, for a softphone or personal leg. */
  userId?: string;
  /** The device, for a device leg. */
  deviceId?: string;
  channel: 'softphone' | 'personal' | 'device' | 'external';
  /** `client:<userId>` for a softphone; E.164 or `sip:…` otherwise. */
  endpoint: string;
}

/** Who a Forward to one user or one device rings — and what to call them in the call log. */
export interface ResolvedRing {
  name: string;
  targets: RingTarget[];
}

@Injectable()
export class CallGroupsService {
  private readonly logger = new Logger(CallGroupsService.name);

  constructor(
    private readonly repository: CallGroupsRepository,
    private readonly directory: UserDirectoryService,
    private readonly presence: PresenceService,
    // Optional so the older specs construct the service without a devices
    // catalog; without one a device member is refused and none is rung.
    @Optional() private readonly devices?: CallDevicesService,
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
    const [everyone, onlineIds, catalog] = await Promise.all([
      this.directory.list(),
      this.presence.listOnline(),
      this.devices ? this.devices.list() : Promise.resolve([] as CallDevice[]),
    ]);
    const byId = new Map(everyone.map((u) => [u.id, u]));
    const online = new Set(onlineIds);
    const deviceById = new Map(catalog.map((d) => [d.id, d]));

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
      // A device that left the catalog stays listed, marked, so an edit never
      // drops it silently — the same courtesy a former teammate gets.
      deviceMembers: [...(group.deviceMembers ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((member): ResolvedCallGroupDeviceMember => {
          const device = deviceById.get(member.deviceId);
          return {
            ...member,
            name: device?.name,
            number: device ? (CallDevicesService.endpointOf(device) ?? undefined) : undefined,
            missing: !device,
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

    // The ring limit counts people and devices together, so it is judged
    // (inside the devices check) before either list is looked up one by one.
    const deviceMembers = await this.validateDeviceMembers(
      dto.deviceMembers ?? [],
      (dto.members ?? []).length,
    );
    const members = await this.validateMembers(dto.members ?? []);
    const active = dto.active ?? true;
    this.assertActivatable(active, members, deviceMembers);

    const now = new Date().toISOString();
    const group: CallGroup = {
      id: randomUUID(),
      name,
      description: dto.description?.trim() || undefined,
      type: dto.type ?? 'ring_all',
      members,
      ...(deviceMembers.length && { deviceMembers }),
      active,
      ringSeconds: dto.ringSeconds ?? CALL_GROUP_LIMITS.defaultRingSeconds,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(group);
    this.logger.log(
      `Call group "${group.name}" created with ${members.length} member(s), ${deviceMembers.length} device(s)`,
    );
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
    this.assertActivatable(active, existing.members ?? [], existing.deviceMembers ?? []);

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

  /**
   * Replace the people, and the devices when they are sent — a client from
   * before devices sends the people alone and keeps the devices as they were.
   */
  async setMembers(
    id: string,
    members: CallGroupMemberDto[],
    caller: { id: string },
    deviceMembers?: CallGroupDeviceMemberDto[],
  ): Promise<CallGroupWithMembers> {
    const existing = await this.mustGet(id);
    const devices =
      deviceMembers === undefined
        ? (existing.deviceMembers ?? [])
        : await this.validateDeviceMembers(deviceMembers, members.length);
    const validated = await this.validateMembers(members);
    this.assertActivatable(existing.active, validated, devices);

    const { deviceMembers: _old, ...rest } = existing;
    await this.repository.put({
      ...rest,
      members: validated,
      ...(devices.length && { deviceMembers: devices }),
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
  private assertActivatable(
    active: boolean,
    members: CallGroupMember[],
    deviceMembers: CallGroupDeviceMember[] = [],
  ): void {
    const ringing =
      members.filter((m) => m.enabled).length + deviceMembers.filter((d) => d.enabled).length;
    if (active && ringing === 0) {
      throw new BadRequestException(
        'A group with nobody to ring cannot be active — add a member or pause the group',
      );
    }
  }

  /**
   * Devices are checked against the catalog the way people are checked
   * against the directory. The ring limit counts both: every leg is a billed
   * call whether a person or a shop line answers it.
   */
  private async validateDeviceMembers(
    members: CallGroupDeviceMemberDto[],
    peopleCount: number,
  ): Promise<CallGroupDeviceMember[]> {
    if (members.length === 0) return [];
    if (peopleCount + members.length > CALL_GROUP_LIMITS.maxMembers) {
      throw new BadRequestException(
        `A group can hold at most ${CALL_GROUP_LIMITS.maxMembers} members — every ` +
          'phone rung in parallel is a billed call',
      );
    }
    if (!this.devices) {
      throw new BadRequestException('Devices are not available on this workspace');
    }
    const seen = new Set<string>();
    for (const member of members) {
      if (seen.has(member.deviceId)) {
        throw new BadRequestException('The same device cannot be added twice');
      }
      seen.add(member.deviceId);
    }
    const catalog = new Map((await this.devices.list()).map((d) => [d.id, d]));
    return members.map((member, index) => {
      if (!catalog.has(member.deviceId)) {
        throw new BadRequestException(
          `${member.deviceId} is not a device in the catalog and cannot be a member`,
        );
      }
      return {
        deviceId: member.deviceId,
        order: member.order ?? index,
        enabled: member.enabled ?? true,
      };
    });
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
      targets.push(...this.userLegs(user, member.channel, online.has(member.userId)));
    }
    // Devices after the people, in their own order: a paused or vanished
    // device is simply not rung, like a deactivated user.
    for (const member of [...(group.deviceMembers ?? [])].sort((a, b) => a.order - b.order)) {
      if (!member.enabled) continue;
      const resolved = await this.resolveDeviceTarget(member.deviceId);
      if (resolved) targets.push(...resolved.targets);
    }
    return targets;
  }

  /**
   * A Forward to one user (Workiz's User tab): their softphone when it is
   * registered and their own number when they have one — both, as a member
   * on the `both` channel. Null when they are not in the directory at all.
   */
  async resolveUserTargets(userId: string): Promise<ResolvedRing | null> {
    const [everyone, onlineIds] = await Promise.all([
      this.directory.list(),
      this.presence.listOnline(),
    ]);
    const user = everyone.find((u: DirectoryUser) => u.id === userId);
    if (!user) return null;
    return { name: user.name, targets: this.userLegs(user, 'both', onlineIds.includes(userId)) };
  }

  /**
   * A Forward to one device, or one device in a group: its number or SIP
   * address as a single leg. Null when it is gone from the catalog; no legs
   * when it is paused.
   */
  async resolveDeviceTarget(deviceId: string): Promise<ResolvedRing | null> {
    const device = this.devices ? await this.devices.findRaw(deviceId) : null;
    if (!device) return null;
    const endpoint = device.active ? CallDevicesService.endpointOf(device) : null;
    return {
      name: device.name,
      targets: endpoint ? [{ deviceId, channel: 'device', endpoint }] : [],
    };
  }

  private userLegs(
    user: DirectoryUser,
    channel: CallGroupMember['channel'],
    online: boolean,
  ): RingTarget[] {
    const legs: RingTarget[] = [];
    if (channel !== 'personal' && online) {
      legs.push({ userId: user.id, channel: 'softphone', endpoint: `client:${user.id}` });
    }
    if (channel !== 'softphone' && user.phone) {
      legs.push({ userId: user.id, channel: 'personal', endpoint: user.phone });
    }
    return legs;
  }
}

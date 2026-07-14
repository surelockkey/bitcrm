import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  SnsPublisherService,
  BusinessMetricsService,
  GeocodingService,
  formatAddress,
} from '@bitcrm/shared';
import {
  type JwtUser,
  type TechnicianProfile,
  type TechnicianHomeAddress,
  type OnboardingStatus,
  UserEventType,
} from '@bitcrm/types';
import { TechniciansRepository } from './technicians.repository';
import { TechniciansCacheService } from './technicians-cache.service';
import { RolesService } from '../roles/roles.service';
import { TechnicianSkillsRepository } from './skills/technician-skills.repository';
import { CommissionRepository } from './commission/commission.repository';
import { UpdateTechnicianDto, OPERATIONAL_FIELDS } from './dto/update-technician.dto';
import { ListTechniciansQueryDto } from './dto/list-technicians-query.dto';
import { deriveOnboardingStatus } from './onboarding.util';

const TECHNICIAN_ROLE_ID = 'role-technician';
const USER_EVENTS_TOPIC = 'user-events';

@Injectable()
export class TechniciansService {
  private readonly logger = new Logger(TechniciansService.name);

  constructor(
    private readonly repository: TechniciansRepository,
    private readonly cache: TechniciansCacheService,
    private readonly rolesService: RolesService,
    private readonly geocoding: GeocodingService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    @Optional() private readonly skillsRepository?: TechnicianSkillsRepository,
    @Optional() private readonly commissionRepository?: CommissionRepository,
  ) {}

  async getProfile(id: string, caller: JwtUser): Promise<TechnicianProfile> {
    await this.assertCanAccessTechnician(caller, id);

    const cached = await this.cache.getProfile(id);
    if (cached) {
      this.businessMetrics?.cacheHits.inc({ entity_type: 'technician' });
      return cached;
    }
    this.businessMetrics?.cacheMisses.inc({ entity_type: 'technician' });

    const profile = await this.repository.getProfile(id);
    if (!profile) {
      throw new NotFoundException('Technician profile not found');
    }
    await this.cache.setProfile(profile);
    return profile;
  }

  /**
   * A technician's home anchors two things: their marker on the dispatch map
   * when they have no jobs that day, and the distance ranking in
   * `GET /deals/:id/qualified-techs`. Both need coordinates.
   *
   * The profile form re-sends the address without lat/lng, and the repository
   * writes `homeAddress` as one whole map — so the stored coordinates used to be
   * erased on every save. An unchanged address therefore carries its existing
   * coordinates over rather than paying to geocode the same string again.
   */
  private async resolveHomeAddress(
    incoming: TechnicianHomeAddress,
    previous?: TechnicianHomeAddress,
  ): Promise<TechnicianHomeAddress> {
    const address = { ...incoming };

    if (address.lat !== undefined && address.lng !== undefined) {
      return address;
    }

    // The home address uses line1/line2; the geocoder speaks street/unit.
    const flatten = (a: TechnicianHomeAddress) => ({
      street: a.line1,
      unit: a.line2,
      city: a.city,
      state: a.state,
      zip: a.zip,
    });

    if (
      previous?.lat !== undefined &&
      previous?.lng !== undefined &&
      formatAddress(flatten(previous)) === formatAddress(flatten(address))
    ) {
      return { ...address, lat: previous.lat, lng: previous.lng };
    }

    const coords = await this.geocoding.geocode(flatten(address));
    return coords ? { ...address, ...coords } : address;
  }

  async updateProfile(
    id: string,
    dto: UpdateTechnicianDto,
    caller: JwtUser,
  ): Promise<TechnicianProfile> {
    const isSelf = caller.id === id;
    const isPrivileged = await this.isPrivilegedCaller(caller);

    if (!isSelf && !isPrivileged) {
      throw new ForbiddenException(
        'You cannot modify another technician’s profile',
      );
    }

    // Field-level authorization: operational fields are manager-only.
    const touchesOperational = OPERATIONAL_FIELDS.some(
      (f) => (dto as Record<string, unknown>)[f] !== undefined,
    );
    if (touchesOperational && !isPrivileged) {
      throw new ForbiddenException(
        'Only a manager can set operational fields (labor cost, status, masking, GPS, mobile app)',
      );
    }

    // Convert the validated DTO (which may contain class instances like
    // HomeAddressDto) into a plain, marshallable object and drop undefined keys.
    const plain = JSON.parse(JSON.stringify(dto)) as Partial<TechnicianProfile>;
    const changedFields = Object.keys(plain);
    const existing = await this.repository.getProfile(id);

    if (plain.homeAddress) {
      plain.homeAddress = await this.resolveHomeAddress(
        plain.homeAddress,
        existing?.homeAddress,
      );
    }

    let result: TechnicianProfile;
    if (!existing) {
      const now = new Date().toISOString();
      const created: TechnicianProfile = {
        userId: id,
        callMaskingEnabled: false,
        gpsTrackingEnabled: false,
        mobileAppInstalled: false,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        ...plain,
      };
      await this.repository.upsertProfile(created);
      this.businessMetrics?.entityCreated.inc({ entity_type: 'technician' });
      result = created;
      this.logger.log(`Created technician profile for ${id}`);
    } else {
      result = await this.repository.updateProfile(id, plain);
      if (dto.status && dto.status !== existing.status) {
        this.logger.log(
          `Technician ${id} status changed ${existing.status} -> ${dto.status}`,
        );
      }
    }

    await this.cache.invalidateProfile(id);
    this.publishTechEvent(UserEventType.TECH_UPDATED, id, changedFields);
    return result;
  }

  async getOnboardingStatus(
    id: string,
    caller: JwtUser,
  ): Promise<OnboardingStatus> {
    await this.assertCanAccessTechnician(caller, id);

    const profile =
      (await this.cache.getProfile(id)) ?? (await this.repository.getProfile(id));

    const skillsApproved = await this.hasApprovedSkillSet(id);
    const commissionSet = this.commissionRepository
      ? Boolean(await this.commissionRepository.getLatest(id))
      : false;

    return deriveOnboardingStatus(profile, { skillsApproved, commissionSet });
  }

  async list(query: ListTechniciansQueryDto, caller: JwtUser) {
    if (!(await this.isPrivilegedCaller(caller))) {
      throw new ForbiddenException(
        'You do not have permission to list technicians',
      );
    }

    const limit = query.limit ?? 20;
    const result = query.status
      ? await this.repository.listByStatus(query.status, limit, query.cursor)
      : await this.repository.listAll(limit, query.cursor);

    return {
      success: true as const,
      data: result.items,
      pagination: {
        nextCursor: result.nextCursor,
        count: result.items.length,
      },
    };
  }

  // --- Private helpers ---

  /** A technician is "skills-approved" once they have ≥1 approved job type and service area. */
  private async hasApprovedSkillSet(userId: string): Promise<boolean> {
    if (!this.skillsRepository) return false;
    const skills = await this.skillsRepository.listByUser(userId);
    const hasJob = skills.some((s) => s.status === 'approved' && s.type === 'job_type');
    const hasArea = skills.some((s) => s.status === 'approved' && s.type === 'service_area');
    return hasJob && hasArea;
  }

  private resolveCallerRoleId(caller: JwtUser): string {
    if (caller.roleId) return caller.roleId;
    throw new ForbiddenException('User has no roleId assigned');
  }

  /** Privileged = Super Admin, or any role ranked above a field Technician. */
  private async isPrivilegedCaller(caller: JwtUser): Promise<boolean> {
    const callerRole = await this.rolesService.findById(
      this.resolveCallerRoleId(caller),
    );
    if (callerRole.isSystem && callerRole.name === 'Super Admin') return true;
    const techRole = await this.rolesService.findById(TECHNICIAN_ROLE_ID);
    return callerRole.priority > techRole.priority;
  }

  private async assertCanAccessTechnician(
    caller: JwtUser,
    targetId: string,
  ): Promise<void> {
    if (caller.id === targetId) return;
    if (await this.isPrivilegedCaller(caller)) return;
    throw new ForbiddenException(
      'You can only access your own technician profile',
    );
  }

  private publishTechEvent(
    eventType: string,
    technicianId: string,
    changedFields: string[],
  ): void {
    if (!this.snsPublisher) return;
    this.snsPublisher
      .publish(USER_EVENTS_TOPIC, eventType, { technicianId, changedFields })
      .catch((err) =>
        this.logger.warn(`Failed to publish ${eventType}: ${err.message}`),
      );
  }
}

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
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
import { UsersService } from '../users/users.service';
import { TechnicianAssignmentsRepository, type TechnicianAssignment } from './assignments/technician-assignments.repository';
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
    @Inject(forwardRef(() => UsersService))
    private readonly users: UsersService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    @Optional() private readonly assignmentsRepository?: TechnicianAssignmentsRepository,
    @Optional() private readonly commissionRepository?: CommissionRepository,
  ) {}

  async getProfile(id: string, caller: JwtUser): Promise<TechnicianProfile> {
    await this.assertCanAccessTechnician(caller, id);

    const cached = await this.cache.getProfile(id);
    if (cached) {
      this.businessMetrics?.cacheHits.inc({ entity_type: 'technician' });
      return this.withPhone(cached);
    }
    this.businessMetrics?.cacheMisses.inc({ entity_type: 'technician' });

    const profile = await this.repository.getProfile(id);
    if (!profile) {
      throw new NotFoundException('Technician profile not found');
    }
    // Cached as stored — the phone is resolved after every read, cache hit
    // included, so changing it elsewhere is never five minutes stale here.
    await this.cache.setProfile(profile);
    return this.withPhone(profile);
  }

  /**
   * Fill in the technician's phone from the user record, which is the only
   * place one is stored: that number is what telephony rings and what the call
   * log matches against.
   *
   * A technician record may still carry a phone from when this module kept its
   * own "dispatch phone" field. That copy was never reachable — a technician
   * could fill it in and still get "no phone number on file" when placing a
   * call — so a stranded one is adopted onto the user record the first time we
   * see it, best-effort: the number may already belong to someone else, and a
   * failed adoption must not cost the caller their profile.
   */
  private async withPhone(profile: TechnicianProfile): Promise<TechnicianProfile> {
    const user = await this.users.findById(profile.userId).catch(() => null);
    if (user?.phone) return { ...profile, phone: user.phone };
    if (!profile.phone) return { ...profile, phone: undefined };

    const adopted = await this.users
      .setPhone(profile.userId, profile.phone)
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not adopt stranded technician phone for ${profile.userId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      });
    return { ...profile, phone: adopted?.phone ?? profile.phone };
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

    // One phone per person, and it lives on the user record. A number arriving
    // through this form is written there; any copy left on the technician item
    // by the old "dispatch phone" field is removed in the same save, so the two
    // can never disagree again.
    const phoneUpdate = plain.phone;
    delete plain.phone;
    if (phoneUpdate !== undefined) {
      await this.users.setPhone(id, phoneUpdate);
      if (existing?.phone) plain.phone = undefined;
    }

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
    return this.withPhone(result);
  }

  async getOnboardingStatus(
    id: string,
    caller: JwtUser,
  ): Promise<OnboardingStatus> {
    await this.assertCanAccessTechnician(caller, id);

    const stored =
      (await this.cache.getProfile(id)) ?? (await this.repository.getProfile(id));
    // "Profile complete" asks whether we can reach this technician, so it has
    // to read the phone from where reaching them reads it.
    const profile = stored ? await this.withPhone(stored) : null;

    const assignmentsApproved = await this.hasApprovedAssignments(id);
    const commissionSet = this.commissionRepository
      ? Boolean(await this.commissionRepository.getLatest(id))
      : false;

    return deriveOnboardingStatus(profile, { assignmentsApproved, commissionSet });
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

  /** Onboarding bar: ≥1 approved job type AND ≥1 approved service area. */
  private async hasApprovedAssignments(userId: string): Promise<boolean> {
    if (!this.assignmentsRepository) return false;
    const all = await this.assignmentsRepository.listByUser(userId);
    const approved = (kind: TechnicianAssignment['kind']) =>
      all.some((a) => a.kind === kind && a.status === 'approved');
    return approved('job_type') && approved('service_area');
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

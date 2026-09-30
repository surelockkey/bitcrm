import { Test } from '@nestjs/testing';
import { CognitoAdminService, PermissionCacheReader } from '@bitcrm/shared';
import { UserStatus } from '@bitcrm/types';
import { UsersService } from '../../../src/users/users.service';
import { UsersRepository } from '../../../src/users/users.repository';
import { UsersCacheService } from '../../../src/users/users-cache.service';
import { RolesService } from '../../../src/roles/roles.service';
import { RolesCacheService } from '../../../src/roles/roles-cache.service';
import { PermissionResolverService } from '../../../src/roles/permission-resolver.service';
import { TechniciansRepository } from '../../../src/technicians/technicians.repository';
import { TechnicianAssignmentsRepository } from '../../../src/technicians/assignments/technician-assignments.repository';
import {
  createMockUser,
  createMockUsersRepository,
  createMockUsersCacheService,
  createMockCognitoAdminService,
  createMockRolesCacheService,
  createMockPermissionResolver,
  createMockPermissionCacheReader,
  createMockTechniciansRepository,
  createMockTechnicianAssignmentsRepository,
} from '../mocks';

/**
 * deal-service projects `GET /api/users/internal/technicians/assignable` into
 * its eligibility read-model and matches deals against it by catalog id. This
 * endpoint returns every technician holding ≥1 approved job type AND service
 * area, with identity + home coordinates for ranking. (The old free-text join is
 * why "qualified technicians" was always empty — see the eligibility projection.)
 */
describe('UsersService — assignable technicians (dispatch)', () => {
  let service: UsersService;
  let usersRepo: ReturnType<typeof createMockUsersRepository>;
  let techRepo: ReturnType<typeof createMockTechniciansRepository>;
  let assignmentsRepo: ReturnType<typeof createMockTechnicianAssignmentsRepository>;

  const ada = createMockUser({
    id: 'tech-1', firstName: 'Ada', lastName: 'Lovelace',
    department: 'Field', roleId: 'role-technician',
  });
  const grace = createMockUser({
    id: 'tech-2', firstName: 'Grace', lastName: 'Hopper',
    department: 'Field', roleId: 'role-technician',
  });

  const jobTypes = [
    { userId: 'tech-1', kind: 'job_type', catalogId: 'jt-lockout', status: 'approved' },
    { userId: 'tech-2', kind: 'job_type', catalogId: 'jt-rekey', status: 'approved' },
  ];
  const serviceAreas = [
    { userId: 'tech-1', kind: 'service_area', catalogId: 'sa-atl', status: 'approved' },
    { userId: 'tech-2', kind: 'service_area', catalogId: 'sa-ngeorgia', status: 'approved' },
  ];

  beforeEach(async () => {
    usersRepo = createMockUsersRepository();
    techRepo = createMockTechniciansRepository();
    assignmentsRepo = createMockTechnicianAssignmentsRepository();

    // The roster is every user, not every technician: the flag that puts
    // someone on the field team sits on the user record, whatever the role.
    usersRepo.findAll.mockResolvedValue({ items: [ada, grace], nextCursor: undefined });
    assignmentsRepo.listAllApproved.mockImplementation((kind: string) =>
      Promise.resolve(kind === 'job_type' ? jobTypes : serviceAreas),
    );
    techRepo.listAll.mockResolvedValue({
      items: [
        {
          userId: 'tech-1',
          homeAddress: { line1: '1 Peachtree St', city: 'Atlanta', state: 'GA', zip: '30303', lat: 33.749, lng: -84.388 },
        },
        // No coordinates — cannot be distance-ranked or mapped.
        { userId: 'tech-2', homeAddress: { line1: '9 Elm St', city: 'Dalton', state: 'GA', zip: '30720' } },
      ],
      nextCursor: undefined,
    });

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: usersRepo },
        { provide: UsersCacheService, useValue: createMockUsersCacheService() },
        { provide: CognitoAdminService, useValue: createMockCognitoAdminService() },
        { provide: PermissionCacheReader, useValue: createMockPermissionCacheReader() },
        { provide: RolesService, useValue: { findById: jest.fn() } },
        { provide: RolesCacheService, useValue: createMockRolesCacheService() },
        { provide: PermissionResolverService, useValue: createMockPermissionResolver() },
        { provide: TechniciansRepository, useValue: techRepo },
        { provide: TechnicianAssignmentsRepository, useValue: assignmentsRepo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('returns technicians with identity, approved catalog ids and home coordinates', async () => {
    const result = await service.listAssignableTechnicians();

    expect(result).toHaveLength(2);
    const first = result.find((t) => t.technicianId === 'tech-1')!;
    expect(first).toMatchObject({
      technicianId: 'tech-1',
      assignable: true,
      firstName: 'Ada',
      lastName: 'Lovelace',
      department: 'Field',
      jobTypeIds: ['jt-lockout'],
      serviceAreaIds: ['sa-atl'],
      homeAddress: { lat: 33.749, lng: -84.388 },
    });
  });

  it('omits homeAddress for a technician whose home has no coordinates', async () => {
    const result = await service.listAssignableTechnicians();
    const second = result.find((t) => t.technicianId === 'tech-2')!;
    expect(second.homeAddress).toBeUndefined();
  });

  /**
   * Approvals stopped gating the roster when the field-team flag arrived: a
   * missing job type or area makes someone a poorer fit for a job, which the
   * assignment dialog shows and ranks by — it does not make them unassignable.
   * The owner who wants a job sent to their phone holds no approvals at all.
   */
  it('keeps a technician with a missing approval on the roster, with what they do hold', async () => {
    assignmentsRepo.listAllApproved.mockImplementation((kind: string) =>
      Promise.resolve(kind === 'job_type' ? jobTypes : [serviceAreas[0]]),
    );

    const result = await service.listAssignableTechnicians();
    expect(result.map((t) => t.technicianId).sort()).toEqual(['tech-1', 'tech-2']);
    expect(result.find((t) => t.technicianId === 'tech-2')).toMatchObject({
      assignable: true,
      jobTypeIds: ['jt-rekey'],
      serviceAreaIds: [],
    });
  });

  /**
   * The bug this pins: these two paths both write deal-service's eligibility
   * projection — the roster on boot, the single answer on `tech.approved` /
   * `tech.updated` — and they used to apply different rules. The single answer
   * never looked at the role, so a dispatcher with an approved job type and
   * service area was projected as an assignable technician and offered in the
   * job's technician picker. Every case below therefore runs through BOTH.
   */
  describe('one definition of assignable, whichever path answers', () => {
    const inRoster = async (userId: string) =>
      (await service.listAssignableTechnicians()).some((t) => t.technicianId === userId);

    const askedDirectly = async (userId: string) =>
      (await service.getTechnicianEligibility(userId)).assignable;

    /** `ada` holds an approved job type and service area throughout. */
    const setUser = (user: ReturnType<typeof createMockUser>) => {
      usersRepo.findAll.mockResolvedValue({ items: [user], nextCursor: undefined });
      usersRepo.findById.mockResolvedValue(user);
      assignmentsRepo.listByUser.mockResolvedValue([
        { userId: user.id, kind: 'job_type', catalogId: 'jt-lockout', status: 'approved' },
        { userId: user.id, kind: 'service_area', catalogId: 'sa-atl', status: 'approved' },
      ]);
    };

    it('accepts an active technician with both approvals', async () => {
      setUser(ada);
      expect(await inRoster('tech-1')).toBe(true);
      expect(await askedDirectly('tech-1')).toBe(true);
    });

    it('rejects a user who is not a technician, however well approved', async () => {
      const dispatcher = createMockUser({ id: 'tech-1', roleId: 'role-dispatcher' });
      setUser(dispatcher);

      expect(await inRoster('tech-1')).toBe(false);
      expect(await askedDirectly('tech-1')).toBe(false);
    });

    it('rejects a deactivated technician — not available for tomorrow’s work', async () => {
      setUser(createMockUser({ id: 'tech-1', roleId: 'role-technician', status: UserStatus.INACTIVE }));

      expect(await inRoster('tech-1')).toBe(false);
      expect(await askedDirectly('tech-1')).toBe(false);
    });

    it('accepts anyone switched onto the field team, whatever their role', async () => {
      // The owner who still does calls: full access, and on the roster.
      setUser(createMockUser({ id: 'owner-1', roleId: 'role-super-admin', fieldTeamMember: true }));

      expect(await inRoster('owner-1')).toBe(true);
      expect(await askedDirectly('owner-1')).toBe(true);
    });

    it('rejects a technician switched off the field team — in the office now', async () => {
      setUser(createMockUser({ id: 'tech-1', roleId: 'role-technician', fieldTeamMember: false }));

      expect(await inRoster('tech-1')).toBe(false);
      expect(await askedDirectly('tech-1')).toBe(false);
    });

    it('rejects an id with no user record behind it', async () => {
      usersRepo.findAll.mockResolvedValue({ items: [], nextCursor: undefined });
      usersRepo.findById.mockResolvedValue(null);
      assignmentsRepo.listByUser.mockResolvedValue([
        { userId: 'ghost', kind: 'job_type', catalogId: 'jt-lockout', status: 'approved' },
        { userId: 'ghost', kind: 'service_area', catalogId: 'sa-atl', status: 'approved' },
      ]);

      expect(await inRoster('ghost')).toBe(false);
      expect(await askedDirectly('ghost')).toBe(false);
    });

    it('keeps a technician whose approvals are still pending — with none of them counted', async () => {
      setUser(ada);
      assignmentsRepo.listAllApproved.mockResolvedValue([]);
      assignmentsRepo.listByUser.mockResolvedValue([
        { userId: 'tech-1', kind: 'job_type', catalogId: 'jt-lockout', status: 'pending' },
        { userId: 'tech-1', kind: 'service_area', catalogId: 'sa-atl', status: 'approved' },
      ]);

      expect(await inRoster('tech-1')).toBe(true);
      expect(await service.getTechnicianEligibility('tech-1')).toMatchObject({
        assignable: true,
        jobTypeIds: [],
        serviceAreaIds: ['sa-atl'],
      });
    });
  });
});

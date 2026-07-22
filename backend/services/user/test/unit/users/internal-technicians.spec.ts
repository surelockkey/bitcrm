import { Test } from '@nestjs/testing';
import { CognitoAdminService, PermissionCacheReader } from '@bitcrm/shared';
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

    usersRepo.findByRoleId.mockResolvedValue([ada, grace]);
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

  it('excludes a technician missing an approved service area', async () => {
    assignmentsRepo.listAllApproved.mockImplementation((kind: string) =>
      Promise.resolve(kind === 'job_type' ? jobTypes : [serviceAreas[0]]),
    );

    const result = await service.listAssignableTechnicians();
    expect(result.map((t) => t.technicianId)).toEqual(['tech-1']);
  });

  it('excludes a technician missing an approved job type', async () => {
    assignmentsRepo.listAllApproved.mockImplementation((kind: string) =>
      Promise.resolve(kind === 'job_type' ? [jobTypes[0]] : serviceAreas),
    );

    const result = await service.listAssignableTechnicians();
    expect(result.map((t) => t.technicianId)).toEqual(['tech-1']);
  });
});

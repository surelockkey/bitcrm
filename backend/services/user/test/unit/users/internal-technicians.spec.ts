import { Test } from '@nestjs/testing';
import { CognitoAdminService, PermissionCacheReader } from '@bitcrm/shared';
import { UsersService } from '../../../src/users/users.service';
import { UsersRepository } from '../../../src/users/users.repository';
import { UsersCacheService } from '../../../src/users/users-cache.service';
import { RolesService } from '../../../src/roles/roles.service';
import { RolesCacheService } from '../../../src/roles/roles-cache.service';
import { PermissionResolverService } from '../../../src/roles/permission-resolver.service';
import { TechniciansRepository } from '../../../src/technicians/technicians.repository';
import { TechnicianSkillsRepository } from '../../../src/technicians/skills/technician-skills.repository';
import {
  createMockUser,
  createMockUsersRepository,
  createMockUsersCacheService,
  createMockCognitoAdminService,
  createMockRolesCacheService,
  createMockPermissionResolver,
  createMockPermissionCacheReader,
  createMockTechniciansRepository,
  createMockTechnicianSkillsRepository,
} from '../mocks';

/**
 * deal-service has always called GET /api/users/internal/technicians to rank
 * technicians for a job. Nobody ever implemented it, so the call 404'd and the
 * error was swallowed into `[]` — which is why "qualified technicians" is empty
 * in the UI. These are the guards for the endpoint that fills that hole.
 */
describe('UsersService — internal technicians (dispatch)', () => {
  let service: UsersService;
  let usersRepo: ReturnType<typeof createMockUsersRepository>;
  let techRepo: ReturnType<typeof createMockTechniciansRepository>;
  let skillsRepo: ReturnType<typeof createMockTechnicianSkillsRepository>;

  const ada = createMockUser({
    id: 'tech-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    department: 'Field',
    roleId: 'role-technician',
  });
  const grace = createMockUser({
    id: 'tech-2',
    firstName: 'Grace',
    lastName: 'Hopper',
    department: 'Field',
    roleId: 'role-technician',
  });

  const approvedSkills = [
    { userId: 'tech-1', type: 'job_type', value: 'Lockout', status: 'approved' },
    { userId: 'tech-1', type: 'service_area', value: 'Atlanta Metro', status: 'approved' },
    { userId: 'tech-2', type: 'job_type', value: 'Rekey', status: 'approved' },
    { userId: 'tech-2', type: 'service_area', value: 'North GA', status: 'approved' },
  ];

  beforeEach(async () => {
    usersRepo = createMockUsersRepository();
    techRepo = createMockTechniciansRepository();
    skillsRepo = createMockTechnicianSkillsRepository();

    usersRepo.findByRoleId.mockResolvedValue([ada, grace]);
    skillsRepo.listAllApproved.mockResolvedValue(approvedSkills);
    techRepo.listAll.mockResolvedValue({
      items: [
        {
          userId: 'tech-1',
          homeAddress: {
            line1: '1 Peachtree St',
            city: 'Atlanta',
            state: 'GA',
            zip: '30303',
            lat: 33.749,
            lng: -84.388,
          },
        },
        // No coordinates — this technician cannot be distance-ranked or mapped.
        {
          userId: 'tech-2',
          homeAddress: {
            line1: '9 Elm St',
            city: 'Dalton',
            state: 'GA',
            zip: '30720',
          },
        },
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
        { provide: TechnicianSkillsRepository, useValue: skillsRepo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('returns technicians with names, approved skills, areas and home coordinates', async () => {
    const result = await service.listTechniciansForDispatch({});

    expect(result).toHaveLength(2);
    const first = result.find((t) => t.id === 'tech-1')!;
    expect(first).toMatchObject({
      id: 'tech-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      department: 'Field',
      skills: ['Lockout'],
      serviceAreas: ['Atlanta Metro'],
      homeAddress: { lat: 33.749, lng: -84.388 },
    });
  });

  it('omits homeAddress for a technician whose home has no coordinates', async () => {
    const result = await service.listTechniciansForDispatch({});

    const second = result.find((t) => t.id === 'tech-2')!;
    expect(second.homeAddress).toBeUndefined();
  });

  it('filters by service area', async () => {
    const result = await service.listTechniciansForDispatch({
      serviceArea: 'North GA',
    });

    expect(result.map((t) => t.id)).toEqual(['tech-2']);
  });

  it('filters by skill', async () => {
    const result = await service.listTechniciansForDispatch({ skill: 'Lockout' });

    expect(result.map((t) => t.id)).toEqual(['tech-1']);
  });

  it('applies service area and skill together', async () => {
    const result = await service.listTechniciansForDispatch({
      serviceArea: 'Atlanta Metro',
      skill: 'Rekey',
    });

    expect(result).toEqual([]);
  });

  it('excludes a technician with no approved skills at all', async () => {
    skillsRepo.listAllApproved.mockResolvedValue([
      { userId: 'tech-1', type: 'job_type', value: 'Lockout', status: 'approved' },
      { userId: 'tech-1', type: 'service_area', value: 'Atlanta Metro', status: 'approved' },
    ]);

    const result = await service.listTechniciansForDispatch({});

    expect(result.map((t) => t.id)).toEqual(['tech-1']);
  });
});

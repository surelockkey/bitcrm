import { UsersService } from '../../../src/users/users.service';
import { APPROVED_ASSIGNMENTS_CACHE_KEY } from '../../../src/technicians/assignments/approved-assignments.cache';
import {
  createMockUser,
  createMockUsersRepository,
  createMockTechniciansRepository,
  createMockTechnicianAssignmentsRepository,
  createMockRedisClient,
} from '../mocks';

/**
 * The whole directory without a Scan: once `backfill:users-all-index` has
 * stamped `USERSALLINDEX / STATE`, every "all users" read (`GET
 * /users/internal/all`, the unfiltered Users page, search, the dispatch
 * roster) Queries the `USERS#ALL` partition of TechnicianIndex. A cursor
 * keeps the walk on the path that issued it, so a gate flipping mid-walk
 * never hands a Scan key to a Query.
 */
describe('UsersService — all-users index', () => {
  const indexCursor = Buffer.from(
    JSON.stringify({ PK: 'USER#u2', SK: 'METADATA', GSI3PK: 'USERS#ALL', GSI3SK: 'USER#u2' }),
  ).toString('base64url');
  const scanCursor = Buffer.from(JSON.stringify({ PK: 'USER#u2', SK: 'METADATA' })).toString('base64url');

  let repo: ReturnType<typeof createMockUsersRepository>;
  let techRepo: ReturnType<typeof createMockTechniciansRepository>;
  let assignments: ReturnType<typeof createMockTechnicianAssignmentsRepository>;
  let redis: ReturnType<typeof createMockRedisClient>;
  let service: UsersService;

  const ada = createMockUser({ id: 'u1', firstName: 'Ada', roleId: 'role-technician' });
  const bob = createMockUser({ id: 'u2', firstName: 'Bob', roleId: 'role-csr', fieldTeamMember: false });
  const cy = createMockUser({ id: 'u3', firstName: 'Cy', roleId: 'role-technician' });

  beforeEach(() => {
    repo = createMockUsersRepository();
    techRepo = createMockTechniciansRepository();
    assignments = createMockTechnicianAssignmentsRepository();
    redis = createMockRedisClient();
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    repo.findAll.mockResolvedValue({ items: [ada, bob, cy], nextCursor: undefined });
    repo.findAllIndexed.mockImplementation(async (_limit: number, cursor?: string) =>
      cursor ? { items: [cy], nextCursor: undefined } : { items: [ada, bob], nextCursor: indexCursor },
    );
    techRepo.listAll.mockResolvedValue({
      items: [{ userId: 'u1', homeAddress: { lat: 1, lng: 2 } }],
      nextCursor: undefined,
    });
    assignments.listAllApproved.mockImplementation(async (kind: string) =>
      kind === 'job_type'
        ? [{ userId: 'u1', kind, catalogId: 'jt-1', status: 'approved' }]
        : [{ userId: 'u1', kind, catalogId: 'sa-1', status: 'approved' }],
    );
    service = new UsersService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      { findById: jest.fn() } as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      techRepo as never,
      undefined,
      assignments as never,
      { client: redis } as never,
    );
  });

  describe('GET /users/internal/all (findAll)', () => {
    it('keeps the table scan until the index is stamped ready', async () => {
      await service.findAll(500);
      expect(repo.findAll).toHaveBeenCalledWith(500, undefined);
      expect(repo.findAllIndexed).not.toHaveBeenCalled();
    });

    it('reads the index once it is ready — same page shape', async () => {
      repo.allUsersIndexReady.mockResolvedValue(true);
      const page = await service.findAll(500);
      expect(repo.findAllIndexed).toHaveBeenCalledWith(500, undefined);
      expect(repo.findAll).not.toHaveBeenCalled();
      expect(page).toEqual({ items: [ada, bob], nextCursor: indexCursor });
    });

    it('an index cursor stays on the index, even where this task has not seen the gate yet', async () => {
      await service.findAll(200, indexCursor);
      expect(repo.findAllIndexed).toHaveBeenCalledWith(200, indexCursor);
      expect(repo.findAll).not.toHaveBeenCalled();
    });

    it('a scan cursor finishes its walk on the scan after the gate flips', async () => {
      repo.allUsersIndexReady.mockResolvedValue(true);
      await service.findAll(200, scanCursor);
      expect(repo.findAll).toHaveBeenCalledWith(200, scanCursor);
      expect(repo.findAllIndexed).not.toHaveBeenCalled();
    });
  });

  it('the unfiltered Users page reads the index too', async () => {
    repo.allUsersIndexReady.mockResolvedValue(true);
    const res = await service.list({ limit: 20 } as never);
    expect(repo.findAllIndexed).toHaveBeenCalledWith(20, undefined);
    expect(res.pagination).toEqual({ nextCursor: indexCursor, count: 2 });
  });

  describe('GET /users/internal/technicians/assignable', () => {
    it('drains the index (no scan) once ready', async () => {
      repo.allUsersIndexReady.mockResolvedValue(true);
      const roster = await service.listAssignableTechnicians();
      expect(repo.findAll).not.toHaveBeenCalled();
      expect(repo.findAllIndexed).toHaveBeenCalledTimes(2);
      expect(roster.map((t) => t.technicianId)).toEqual(['u1', 'u3']);
    });

    it('takes the approved catalog ids from the shared approved-assignments cache when it holds them', async () => {
      redis.get.mockImplementation(async (key: string) =>
        key === APPROVED_ASSIGNMENTS_CACHE_KEY
          ? JSON.stringify({
              jobTypes: [{ userId: 'u3', jobTypeId: 'jt-9', status: 'approved' }],
              serviceAreas: [{ userId: 'u3', serviceAreaId: 'sa-9', status: 'approved' }],
            })
          : null,
      );
      const roster = await service.listAssignableTechnicians();
      expect(assignments.listAllApproved).not.toHaveBeenCalled();
      expect(roster.find((t) => t.technicianId === 'u3')).toEqual(
        expect.objectContaining({ jobTypeIds: ['jt-9'], serviceAreaIds: ['sa-9'] }),
      );
      expect(roster.find((t) => t.technicianId === 'u1')).toEqual(
        expect.objectContaining({ jobTypeIds: [], serviceAreaIds: [] }),
      );
    });

    it('on a miss reads the approved sets and fills the cache in the shape the Team list reads', async () => {
      const roster = await service.listAssignableTechnicians();
      expect(assignments.listAllApproved).toHaveBeenCalledTimes(2);
      expect(redis.set).toHaveBeenCalledWith(APPROVED_ASSIGNMENTS_CACHE_KEY, expect.any(String), 'EX', 300);
      const cached = JSON.parse(redis.set.mock.calls[0][1]);
      expect(cached.jobTypes[0]).toEqual(expect.objectContaining({ userId: 'u1', jobTypeId: 'jt-1' }));
      expect(roster).toEqual([
        {
          technicianId: 'u1',
          assignable: true,
          jobTypeIds: ['jt-1'],
          serviceAreaIds: ['sa-1'],
          firstName: 'Ada',
          lastName: 'Doe',
          department: 'HVAC',
          homeAddress: { lat: 1, lng: 2 },
        },
        {
          technicianId: 'u3',
          assignable: true,
          jobTypeIds: [],
          serviceAreaIds: [],
          firstName: 'Cy',
          lastName: 'Doe',
          department: 'HVAC',
          homeAddress: undefined,
        },
      ]);
    });

    it('a broken cache costs nothing but the cache', async () => {
      redis.get.mockRejectedValue(new Error('redis down'));
      redis.set.mockRejectedValue(new Error('redis down'));
      const roster = await service.listAssignableTechnicians();
      expect(roster.find((t) => t.technicianId === 'u1')?.jobTypeIds).toEqual(['jt-1']);
    });
  });
});

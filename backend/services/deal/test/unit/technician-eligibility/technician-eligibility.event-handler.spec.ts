import { TechnicianEligibilityEventHandler } from '../../../src/technician-eligibility/technician-eligibility.event-handler';

describe('TechnicianEligibilityEventHandler (unit)', () => {
  let repo: { upsert: jest.Mock; remove: jest.Mock; get: jest.Mock; listAll: jest.Mock };
  let http: { getTechnicianEligibility: jest.Mock };
  let handler: TechnicianEligibilityEventHandler;

  const assignable = {
    technicianId: 'tech-1',
    assignable: true,
    jobTypeIds: ['jt-1'],
    serviceAreaIds: ['sa-1'],
    firstName: 'Ada',
    lastName: 'Lovelace',
    department: 'ATL',
    homeAddress: { lat: 33.7, lng: -84.4 },
  };

  beforeEach(() => {
    repo = { upsert: jest.fn(), remove: jest.fn(), get: jest.fn(), listAll: jest.fn() };
    http = { getTechnicianEligibility: jest.fn() };
    handler = new TechnicianEligibilityEventHandler(repo as never, http as never);
  });

  describe('handleTechApproved', () => {
    it('re-fetches the authoritative record and upserts it with display fields', async () => {
      http.getTechnicianEligibility.mockResolvedValue(assignable);

      await handler.handleTechApproved({
        technicianId: 'tech-1',
        jobTypeIds: ['jt-1'],
        serviceAreaIds: ['sa-1'],
      });

      expect(http.getTechnicianEligibility).toHaveBeenCalledWith('tech-1');
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          technicianId: 'tech-1',
          jobTypeIds: ['jt-1'],
          serviceAreaIds: ['sa-1'],
          assignable: true,
          firstName: 'Ada',
          homeAddress: { lat: 33.7, lng: -84.4 },
        }),
      );
    });
  });

  describe('handleTechUpdated', () => {
    it('re-fetches eligibility and upserts when still assignable', async () => {
      http.getTechnicianEligibility.mockResolvedValue(assignable);

      await handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['assignments'] });

      expect(http.getTechnicianEligibility).toHaveBeenCalledWith('tech-1');
      expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ assignable: true }));
    });

    it('removes the projection when no longer assignable', async () => {
      http.getTechnicianEligibility.mockResolvedValue({
        technicianId: 'tech-1',
        assignable: false,
        jobTypeIds: [],
        serviceAreaIds: [],
      });

      await handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['assignments'] });

      expect(repo.remove).toHaveBeenCalledWith('tech-1');
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('ignores changes that do not touch assignments (no fetch)', async () => {
      await handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['commission'] });

      expect(http.getTechnicianEligibility).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });
});

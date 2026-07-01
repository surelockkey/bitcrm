import { TechnicianEligibilityEventHandler } from '../../../src/technician-eligibility/technician-eligibility.event-handler';

describe('TechnicianEligibilityEventHandler (unit)', () => {
  let repo: { upsert: jest.Mock; remove: jest.Mock; get: jest.Mock; listAll: jest.Mock };
  let http: { getTechnicianEligibility: jest.Mock };
  let handler: TechnicianEligibilityEventHandler;

  beforeEach(() => {
    repo = { upsert: jest.fn(), remove: jest.fn(), get: jest.fn(), listAll: jest.fn() };
    http = { getTechnicianEligibility: jest.fn() };
    handler = new TechnicianEligibilityEventHandler(repo as never, http as never);
  });

  describe('handleTechApproved', () => {
    it('upserts the eligibility projection (assignable)', async () => {
      await handler.handleTechApproved({
        technicianId: 'tech-1',
        approvedSkills: ['Locksmith'],
        serviceAreas: ['Atlanta'],
      });
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          technicianId: 'tech-1',
          approvedSkills: ['Locksmith'],
          serviceAreas: ['Atlanta'],
          assignable: true,
        }),
      );
    });
  });

  describe('handleTechUpdated', () => {
    it('re-fetches eligibility and upserts when still assignable', async () => {
      http.getTechnicianEligibility.mockResolvedValue({
        technicianId: 'tech-1',
        assignable: true,
        approvedSkills: ['Locksmith'],
        serviceAreas: ['Atlanta'],
      });
      await handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['skills'] });
      expect(http.getTechnicianEligibility).toHaveBeenCalledWith('tech-1');
      expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ assignable: true }));
    });

    it('removes the projection when no longer assignable', async () => {
      http.getTechnicianEligibility.mockResolvedValue({
        technicianId: 'tech-1',
        assignable: false,
        approvedSkills: [],
        serviceAreas: [],
      });
      await handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['skills'] });
      expect(repo.remove).toHaveBeenCalledWith('tech-1');
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('ignores non-skill changes (no fetch)', async () => {
      await handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['commission'] });
      expect(http.getTechnicianEligibility).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });
});

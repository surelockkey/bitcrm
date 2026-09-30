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

    it('refreshes when someone is switched onto or off the field team', async () => {
      http.getTechnicianEligibility.mockResolvedValue({
        ...assignable,
        assignable: false,
        jobTypeIds: [],
        serviceAreaIds: [],
      });

      await handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['fieldTeamMember'] });

      expect(http.getTechnicianEligibility).toHaveBeenCalledWith('tech-1');
      expect(repo.remove).toHaveBeenCalledWith('tech-1');
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

    it('ignores changes that do not touch eligibility (no fetch)', async () => {
      await handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['commission'] });

      expect(http.getTechnicianEligibility).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    /**
     * Approvals were the only marker acted on, so the two other ways of
     * ceasing to be an assignable technician — losing the role, having the
     * account switched off — left the row in the assignment dialog until
     * deal-service happened to restart.
     */
    it('re-reads eligibility when the user’s role changed', async () => {
      http.getTechnicianEligibility.mockResolvedValue({
        technicianId: 'tech-1',
        assignable: false,
        jobTypeIds: [],
        serviceAreaIds: [],
      });

      await handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['role'] });

      expect(http.getTechnicianEligibility).toHaveBeenCalledWith('tech-1');
      expect(repo.remove).toHaveBeenCalledWith('tech-1');
    });

    it('re-reads eligibility when the account was deactivated', async () => {
      http.getTechnicianEligibility.mockResolvedValue({
        technicianId: 'tech-1',
        assignable: false,
        jobTypeIds: [],
        serviceAreaIds: [],
      });

      await handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['status'] });

      expect(repo.remove).toHaveBeenCalledWith('tech-1');
    });

    /**
     * A failed lookup must not read as "not assignable" — that would delete a
     * working technician's row on a user-service hiccup. Throwing hands the
     * message back to SQS for redelivery.
     */
    it('touches nothing and rethrows when the eligibility lookup fails', async () => {
      http.getTechnicianEligibility.mockRejectedValue(new Error('502 Bad Gateway'));

      await expect(
        handler.handleTechUpdated({ technicianId: 'tech-1', changedFields: ['assignments'] }),
      ).rejects.toThrow('502 Bad Gateway');

      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });
});

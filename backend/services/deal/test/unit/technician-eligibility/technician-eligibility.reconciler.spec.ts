import { TechnicianEligibilityReconciler } from '../../../src/technician-eligibility/technician-eligibility.reconciler';

describe('TechnicianEligibilityReconciler (unit)', () => {
  let repo: {
    upsert: jest.Mock;
    remove: jest.Mock;
    listAll: jest.Mock;
    listLegacy: jest.Mock;
    removeLegacy: jest.Mock;
  };
  let http: { listAssignableTechnicians: jest.Mock };
  let reconciler: TechnicianEligibilityReconciler;

  const projected = (technicianId: string) => ({
    technicianId,
    jobTypeIds: ['jt-1'],
    serviceAreaIds: ['sa-1'],
    assignable: true,
    updatedAt: '2026-08-19T00:00:00.000Z',
  });

  beforeEach(() => {
    repo = {
      upsert: jest.fn(),
      remove: jest.fn(),
      listAll: jest.fn().mockResolvedValue([]),
      listLegacy: jest.fn().mockResolvedValue([]),
      removeLegacy: jest.fn(),
    };
    http = { listAssignableTechnicians: jest.fn() };
    reconciler = new TechnicianEligibilityReconciler(repo as never, http as never);
  });

  it('upserts an eligibility projection for each assignable technician on boot', async () => {
    http.listAssignableTechnicians.mockResolvedValue([
      { technicianId: 't1', jobTypeIds: ['jt-1'], serviceAreaIds: ['sa-1'] },
      { technicianId: 't2', jobTypeIds: ['jt-2'], serviceAreaIds: ['sa-2'] },
    ]);
    await reconciler.onModuleInit();
    expect(repo.upsert).toHaveBeenCalledTimes(2);
    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ technicianId: 't1', assignable: true }));
  });

  it('never throws (best-effort) if user-service is unreachable', async () => {
    http.listAssignableTechnicians.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(reconciler.onModuleInit()).resolves.toBeUndefined();
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  /**
   * The half that was missing: the projection could only grow. A row written
   * for someone who is not a technician — a seed script, an approval on the
   * wrong user, a technician since demoted — stayed in the assignment dialog
   * for good, because the only removal path was an event about a technician
   * nobody edits as one any more.
   */
  describe('removing what no longer qualifies', () => {
    it('removes a projected row the authoritative roster does not contain', async () => {
      repo.listAll.mockResolvedValue([projected('t1'), projected('test-tech-ct-3')]);
      http.listAssignableTechnicians.mockResolvedValue([
        { technicianId: 't1', jobTypeIds: ['jt-1'], serviceAreaIds: ['sa-1'] },
      ]);

      await reconciler.onModuleInit();

      expect(repo.remove).toHaveBeenCalledTimes(1);
      expect(repo.remove).toHaveBeenCalledWith('test-tech-ct-3');
    });

    it('keeps every row the roster still contains', async () => {
      repo.listAll.mockResolvedValue([projected('t1'), projected('t2')]);
      http.listAssignableTechnicians.mockResolvedValue([
        { technicianId: 't1', jobTypeIds: ['jt-1'], serviceAreaIds: ['sa-1'] },
        { technicianId: 't2', jobTypeIds: ['jt-2'], serviceAreaIds: ['sa-2'] },
      ]);

      await reconciler.onModuleInit();

      expect(repo.remove).not.toHaveBeenCalled();
    });
  });

  /**
   * The reconcile is the only thing here that can destroy data, so it acts
   * only on an answer it is sure of. Both cases below are indistinguishable
   * from a user-service that is down, and emptying dispatch at boot is far
   * worse than carrying a stale row for one more cycle.
   */
  describe('an answer it cannot trust changes nothing', () => {
    it('removes nothing when user-service did not answer', async () => {
      repo.listAll.mockResolvedValue([projected('t1'), projected('t2')]);
      http.listAssignableTechnicians.mockResolvedValue(null);

      await reconciler.onModuleInit();

      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('removes nothing when user-service reports an empty roster', async () => {
      repo.listAll.mockResolvedValue([projected('t1'), projected('t2')]);
      http.listAssignableTechnicians.mockResolvedValue([]);

      await reconciler.onModuleInit();

      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('removes nothing when the roster call throws', async () => {
      repo.listAll.mockResolvedValue([projected('t1')]);
      http.listAssignableTechnicians.mockRejectedValue(new Error('ETIMEDOUT'));

      await reconciler.onModuleInit();

      expect(repo.remove).not.toHaveBeenCalled();
    });
  });

  /**
   * The rows moved from one partition per technician into one partition for
   * all of them. Boot carries the old rows over before anything else, and
   * without user-service: were the move left to the reconcile alone, a
   * user-service that is down at the first boot would leave dispatch with no
   * technicians to suggest at all.
   */
  describe('moving the pre-move rows', () => {
    it('copies each old row into the new partition, then deletes the old one', async () => {
      repo.listLegacy.mockResolvedValue([projected('t1'), projected('t2')]);
      http.listAssignableTechnicians.mockResolvedValue(null);

      await reconciler.onModuleInit();

      expect(repo.upsert).toHaveBeenCalledWith(projected('t1'));
      expect(repo.upsert).toHaveBeenCalledWith(projected('t2'));
      expect(repo.removeLegacy).toHaveBeenCalledWith('t1');
      expect(repo.removeLegacy).toHaveBeenCalledWith('t2');
      // Copied before deleted: a crash between the two leaves a duplicate, never a gap.
      const copied = repo.upsert.mock.invocationCallOrder[repo.upsert.mock.calls.findIndex(([e]) => e.technicianId === 't1')];
      const deleted = repo.removeLegacy.mock.invocationCallOrder[repo.removeLegacy.mock.calls.findIndex(([id]) => id === 't1')];
      expect(copied).toBeLessThan(deleted);
    });

    it('leaves the old layout alone once the new partition holds anyone', async () => {
      repo.listAll.mockResolvedValue([projected('t1')]);
      http.listAssignableTechnicians.mockResolvedValue([
        { technicianId: 't1', jobTypeIds: ['jt-1'], serviceAreaIds: ['sa-1'] },
      ]);

      await reconciler.onModuleInit();

      expect(repo.listLegacy).not.toHaveBeenCalled();
      expect(repo.removeLegacy).not.toHaveBeenCalled();
    });

    it('a failed move does not stop the reconcile', async () => {
      repo.listLegacy.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));
      http.listAssignableTechnicians.mockResolvedValue([
        { technicianId: 't1', jobTypeIds: ['jt-1'], serviceAreaIds: ['sa-1'] },
      ]);

      await reconciler.onModuleInit();

      expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ technicianId: 't1' }));
    });
  });
});

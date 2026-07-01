import { TechnicianEligibilityBackfill } from '../../../src/technician-eligibility/technician-eligibility.backfill';

describe('TechnicianEligibilityBackfill (unit)', () => {
  let repo: { upsert: jest.Mock };
  let http: { listAssignableTechnicians: jest.Mock };
  let backfill: TechnicianEligibilityBackfill;

  beforeEach(() => {
    repo = { upsert: jest.fn() };
    http = { listAssignableTechnicians: jest.fn() };
    backfill = new TechnicianEligibilityBackfill(repo as never, http as never);
  });

  it('upserts an eligibility projection for each assignable technician on boot', async () => {
    http.listAssignableTechnicians.mockResolvedValue([
      { technicianId: 't1', approvedSkills: ['Locksmith'], serviceAreas: ['Atlanta'] },
      { technicianId: 't2', approvedSkills: ['Rekeying'], serviceAreas: ['North GA'] },
    ]);
    await backfill.onModuleInit();
    expect(repo.upsert).toHaveBeenCalledTimes(2);
    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ technicianId: 't1', assignable: true }));
  });

  it('never throws (best-effort) if user-service is unreachable', async () => {
    http.listAssignableTechnicians.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(backfill.onModuleInit()).resolves.toBeUndefined();
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});

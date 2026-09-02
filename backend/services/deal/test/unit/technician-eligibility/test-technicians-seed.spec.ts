import {
  CT_SERVICE_AREA_ID,
  JOB_TYPE_IDS,
  TEST_TECHNICIANS,
  planTestTechnicians,
} from 'src/scripts/test-technicians.catalog';

describe('Test technician seed', () => {
  it('creates 10 technicians, all in the Connecticut service area', () => {
    const rows = planTestTechnicians();
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.serviceAreaIds).toEqual([CT_SERVICE_AREA_ID]);
      expect(r.assignable).toBe(true);
      expect(r.technicianId).toMatch(/^test-tech-ct-\d+$/);
      expect(r.firstName).toBeTruthy();
      expect(r.lastName).toBeTruthy();
    }
  });

  it('spreads the technicians across the job types for testing', () => {
    const rows = planTestTechnicians();
    const covers = (jt: string) => rows.filter((r) => r.jobTypeIds.includes(jt)).length;

    // Every job type has more than one tech, and at least one tech does all.
    expect(covers(JOB_TYPE_IDS.garageDoor)).toBeGreaterThan(1);
    expect(covers(JOB_TYPE_IDS.lockout)).toBeGreaterThan(1);
    expect(covers(JOB_TYPE_IDS.rekey)).toBeGreaterThan(1);
    expect(rows.some((r) => r.jobTypeIds.length === 3)).toBe(true);
    expect(rows.some((r) => r.jobTypeIds.length === 1)).toBe(true);
  });

  it('references only real catalog job-type ids', () => {
    const valid = new Set<string>(Object.values(JOB_TYPE_IDS));
    for (const r of TEST_TECHNICIANS) {
      for (const jt of r.jobTypeIds) expect(valid.has(jt)).toBe(true);
    }
  });

  it('gives every tech a Connecticut home coordinate for distance ranking', () => {
    for (const r of planTestTechnicians()) {
      expect(r.homeAddress?.lat).toBeGreaterThan(40.5);
      expect(r.homeAddress?.lat).toBeLessThan(42.5);
      expect(r.homeAddress?.lng).toBeLessThan(-71.5);
      expect(r.homeAddress?.lng).toBeGreaterThan(-73.8);
    }
  });

  it('uses deterministic ids so reruns overwrite rather than duplicate', () => {
    expect(planTestTechnicians().map((r) => r.technicianId)).toEqual(
      planTestTechnicians().map((r) => r.technicianId),
    );
  });
});

import { jobCostsOf, manualTotalSnapshot } from 'src/deals/billing/deal-totals';

/**
 * Workiz's quick view lets a dispatcher type a job's Total before any line
 * item exists (`job_total_price`), and carries two job-level costs: Tech Cost
 * (`parts`) and Company Cost (`company_parts`). The importer already stores
 * those two under their Workiz names; the API reads them as ours.
 */
describe('manualTotalSnapshot', () => {
  it('is a whole snapshot worth the typed amount, flagged manual', () => {
    expect(manualTotalSnapshot(150)).toEqual({
      subtotal: 150,
      discount: 0,
      tax: 0,
      total: 150,
      cost: 0,
      taxableBase: 0,
      manual: true,
    });
  });

  it('keeps money to the cent', () => {
    expect(manualTotalSnapshot(12.345).total).toBe(12.35);
    expect(manualTotalSnapshot(0.1 + 0.2).subtotal).toBe(0.3);
  });
});

describe('jobCostsOf', () => {
  it("reads the job's own fields", () => {
    expect(jobCostsOf({ techCost: 20, companyCost: 5.5 })).toEqual({ techCost: 20, companyCost: 5.5 });
  });

  it("falls back to what the importer wrote under Workiz's names", () => {
    expect(jobCostsOf({ parts: 82.74, companyParts: 842.3 })).toEqual({ techCost: 82.74, companyCost: 842.3 });
  });

  it('prefers a value set here over the imported one', () => {
    expect(jobCostsOf({ techCost: 1, parts: 2, companyCost: 3, companyParts: 4 })).toEqual({ techCost: 1, companyCost: 3 });
  });

  it('leaves out what is not there, including nulls and blanks', () => {
    expect(jobCostsOf({})).toEqual({});
    expect(jobCostsOf({ parts: null, companyParts: '' })).toEqual({});
  });

  it('accepts a numeric string from an older import', () => {
    expect(jobCostsOf({ parts: '12.50' })).toEqual({ techCost: 12.5 });
  });
});

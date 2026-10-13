import {
  jobPartiesOf,
  mergeEventDeal,
  renameContact,
  scopeDealsOf,
  type TechScopeDeal,
} from '../../../src/tech-scope/tech-scope.logic';
import { createMockDeal } from '../api/api-mocks';

describe('tech scope — the visibility rule, as pure functions', () => {
  it('scopeDealsOf keeps the jobs whose roster names the technician, in the order deal-service gave', () => {
    const deals = [
      createMockDeal({ id: 'd1', contactId: 'ct1' }),
      createMockDeal({ id: 'd2', contactId: 'ct2', assignedTechIds: ['tech-2'] }),
      createMockDeal({ id: 'd3', contactId: 'ct3', companyId: 'co1' }),
    ];
    expect(scopeDealsOf(deals, 'tech-1')).toEqual([
      { id: 'd1', contactId: 'ct1' },
      { id: 'd3', contactId: 'ct3', companyId: 'co1' },
    ]);
  });

  it('jobPartiesOf: contact then company per job, first occurrence wins — the order the inbox tie-breaks on', () => {
    const deals: TechScopeDeal[] = [
      { id: 'd1', contactId: 'ct1' },
      { id: 'd2', contactId: 'ct2', companyId: 'co1' },
      { id: 'd3', contactId: 'ct1', companyId: 'co1' },
    ];
    expect(jobPartiesOf(deals)).toEqual([
      { kind: 'contact', id: 'ct1' },
      { kind: 'contact', id: 'ct2' },
      { kind: 'company', id: 'co1' },
    ]);
  });

  describe('mergeEventDeal — the job an event is about, read fresh, wins over a lagging index', () => {
    const base: TechScopeDeal[] = [
      { id: 'd1', contactId: 'ct1' },
      { id: 'd2', contactId: 'ct2' },
    ];

    it('a job just assigned that the index does not show yet is added in front', () => {
      const fresh = createMockDeal({ id: 'd9', contactId: 'ct9' });
      expect(mergeEventDeal(base, fresh, 'tech-1').map((d) => d.id)).toEqual(['d9', 'd1', 'd2']);
    });

    it('a job whose client changed keeps its place with the new client', () => {
      const fresh = createMockDeal({ id: 'd2', contactId: 'ct7', companyId: 'co7' });
      expect(mergeEventDeal(base, fresh, 'tech-1')).toEqual([
        { id: 'd1', contactId: 'ct1' },
        { id: 'd2', contactId: 'ct7', companyId: 'co7' },
      ]);
    });

    it('a job the technician left, or that was deleted, goes', () => {
      expect(mergeEventDeal(base, createMockDeal({ id: 'd1', assignedTechIds: ['tech-2'] }), 'tech-1').map((d) => d.id)).toEqual(['d2']);
      expect(mergeEventDeal(base, createMockDeal({ id: 'd2', status: 'deleted' }), 'tech-1').map((d) => d.id)).toEqual(['d1']);
    });

    it('no fresh read changes nothing', () => {
      expect(mergeEventDeal(base, null, 'tech-1')).toEqual(base);
    });
  });

  it('renameContact follows a CRM merge: the duplicate becomes the survivor, nothing else moves', () => {
    expect(
      renameContact(
        [
          { id: 'd1', contactId: 'dup' },
          { id: 'd2', contactId: 'ct2', companyId: 'co1' },
        ],
        'dup',
        'win',
      ),
    ).toEqual([
      { id: 'd1', contactId: 'win' },
      { id: 'd2', contactId: 'ct2', companyId: 'co1' },
    ]);
  });
});

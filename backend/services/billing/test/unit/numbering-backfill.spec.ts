import { highestClientNumber, planNumberingBackfill } from 'src/numbering/numbering-backfill';

/**
 * `backfill:numbering` — after a Workiz import the counters must stand past
 * the numbers the imported CLIENT documents carry, or Settings → Numbering
 * would let the office set a number already in use. The script walks the
 * INVOICES / ESTIMATES list partitions and raises each counter to the
 * highest numeric client number it finds — never lowers one, never touches
 * a counter already past it.
 */
describe('highestClientNumber', () => {
  it('is the highest numeric number among the documents with no job; a job’s coded number never counts', () => {
    expect(
      highestClientNumber([
        { number: '1140' },
        { number: '1139' },
        { number: 'K4T9ZW', dealId: 'deal-1' },
        { number: '99999', dealId: 'deal-2' }, // a job invoice: its number is the job's, not the counter's
        { number: '1YFN8I' }, // an imported stub with Workiz's coded serial: not numeric
        { number: '85084' },
      ]),
    ).toBe(85084);
  });

  it('is 0 when no client document carries a number', () => {
    expect(highestClientNumber([])).toBe(0);
    expect(highestClientNumber([{ number: 'ABC123' }, { number: 'X', dealId: 'd' }])).toBe(0);
  });
});

describe('planNumberingBackfill', () => {
  it('raises a counter to the highest number found when that is past what was handed out', () => {
    expect(planNumberingBackfill({}, { invoice: 85425, estimate: 1140 })).toEqual([
      { kind: 'invoice', from: 1000, to: 85425 },
      { kind: 'estimate', from: 1000, to: 1140 },
    ]);
  });

  it('leaves a counter alone when it already stands past the documents, or when nothing numeric was found', () => {
    expect(planNumberingBackfill({ lastInvoiceNumber: 85426, lastEstimateNumber: 1141 }, { invoice: 85425, estimate: 1141 })).toEqual([]);
    expect(planNumberingBackfill({ documentSeq: 3 }, { invoice: 0, estimate: 1002 })).toEqual([]);
  });

  it('counts the legacy numbers as handed out', () => {
    expect(planNumberingBackfill({ documentSeq: 140 }, { invoice: 1141, estimate: 1100 })).toEqual([
      { kind: 'invoice', from: 1140, to: 1141 },
    ]);
  });
});

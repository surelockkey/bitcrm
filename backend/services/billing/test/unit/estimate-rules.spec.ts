import type { Estimate, EstimateItem } from '@bitcrm/types';
import {
  assertSyncable,
  estimateNumber,
  estimateTotals,
  markSentChanges,
  reorderPositions,
  statusChanges,
} from 'src/estimates/estimate-rules';

const NOW = '2026-09-16T12:00:00.000Z';

const estimate = (over: Partial<Estimate> = {}): Estimate =>
  ({
    id: 'e1',
    number: 'ABC123-1',
    dealId: 'd1',
    dealNumber: 'ABC123',
    contactId: 'c1',
    status: 'unsent',
    estimateDate: '2026-09-16',
    totals: {} as never,
    version: 1,
    createdBy: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as Estimate;

const item = (lineId: string, position: number, over: Partial<EstimateItem> = {}): EstimateItem => ({
  lineId,
  estimateId: 'e1',
  position,
  productId: `p-${lineId}`,
  name: lineId,
  sku: lineId,
  quantity: 1,
  priceClient: 100,
  costCompany: 0,
  costForTech: 0,
  taxable: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

describe('estimate numbering', () => {
  it('is <dealNumber>-<n>', () => {
    expect(estimateNumber('K4T9ZW', 1)).toBe('K4T9ZW-1');
    expect(estimateNumber('1042', 12)).toBe('1042-12');
  });
});

describe('status changes', () => {
  it('stamps statusChangedAt and the per-status timestamp', () => {
    expect(statusChanges(estimate(), 'approved', NOW)).toEqual({
      status: 'approved',
      statusChangedAt: NOW,
      approvedAt: NOW,
    });
    expect(statusChanges(estimate(), 'declined', NOW)).toMatchObject({ declinedAt: NOW });
    expect(statusChanges(estimate(), 'won', NOW)).toMatchObject({ wonAt: NOW });
    expect(statusChanges(estimate(), 'archived', NOW)).toEqual({
      status: 'archived',
      statusChangedAt: NOW,
    });
  });

  it('allows any manual status, including going back to unsent', () => {
    expect(statusChanges(estimate({ status: 'won' }), 'unsent', NOW)).toEqual({
      status: 'unsent',
      statusChangedAt: NOW,
    });
  });

  it('returns nothing when the status does not change', () => {
    expect(statusChanges(estimate({ status: 'pending' }), 'pending', NOW)).toEqual({});
  });
});

describe('mark sent', () => {
  it('sets sentAt/sentBy and moves unsent to pending', () => {
    expect(markSentChanges(estimate(), true, 'u2', NOW)).toEqual({
      set: { sentAt: NOW, sentBy: 'u2', status: 'pending', statusChangedAt: NOW },
      remove: [],
    });
  });

  it('keeps a non-unsent status when sending', () => {
    expect(markSentChanges(estimate({ status: 'approved' }), true, 'u2', NOW)).toEqual({
      set: { sentAt: NOW, sentBy: 'u2' },
      remove: [],
    });
  });

  it('un-sending clears the stamps and returns pending to unsent', () => {
    expect(
      markSentChanges(estimate({ status: 'pending', sentAt: NOW, sentBy: 'u2' }), false, 'u2', NOW),
    ).toEqual({
      set: { status: 'unsent', statusChangedAt: NOW },
      remove: ['sentAt', 'sentBy'],
    });
    expect(
      markSentChanges(estimate({ status: 'won', sentAt: NOW }), false, 'u2', NOW),
    ).toEqual({ set: {}, remove: ['sentAt', 'sentBy'] });
  });
});

describe('sync-to-job guard', () => {
  it('needs at least one item', () => {
    expect(() => assertSyncable(estimate(), 0)).toThrow(/at least one item/i);
  });

  it('is refused for archived estimates', () => {
    expect(() => assertSyncable(estimate({ status: 'archived' }), 2)).toThrow(/archived/i);
  });

  it('is allowed from every other status', () => {
    for (const status of ['unsent', 'pending', 'approved', 'declined', 'won'] as const) {
      expect(() => assertSyncable(estimate({ status }), 1)).not.toThrow();
    }
  });
});

describe('reorder', () => {
  const items = [item('a', 0), item('b', 1), item('c', 2)];

  it('returns the new position of every moved line', () => {
    expect(reorderPositions(items, ['c', 'a', 'b'])).toEqual([
      { lineId: 'c', position: 0 },
      { lineId: 'a', position: 1 },
      { lineId: 'b', position: 2 },
    ]);
  });

  it('skips lines already in place', () => {
    expect(reorderPositions(items, ['a', 'c', 'b'])).toEqual([
      { lineId: 'c', position: 1 },
      { lineId: 'b', position: 2 },
    ]);
  });

  it('rejects a list that is not a permutation of the lines', () => {
    expect(() => reorderPositions(items, ['a', 'b'])).toThrow();
    expect(() => reorderPositions(items, ['a', 'b', 'x'])).toThrow();
    expect(() => reorderPositions(items, ['a', 'a', 'b'])).toThrow();
  });
});

describe('estimate totals', () => {
  it('uses the snapshotted tax percent, discount and taxable flags', () => {
    const totals = estimateTotals(
      estimate({ taxRatePercent: 10, discount: { type: 'percent', value: 10 } }),
      [item('a', 0), item('b', 1, { taxable: false, quantity: 2, priceClient: 25 })],
    );
    expect(totals.subtotal).toBe(150);
    expect(totals.discount).toBe(15);
    expect(totals.taxableBase).toBe(90);
    expect(totals.tax).toBe(9);
    expect(totals.total).toBe(144);
    expect(totals.lineCount).toBe(2);
  });

  it('charges no tax when exempt', () => {
    const totals = estimateTotals(estimate({ taxRatePercent: 10, taxSource: 'exempt' }), [item('a', 0)]);
    expect(totals.tax).toBe(0);
  });
});

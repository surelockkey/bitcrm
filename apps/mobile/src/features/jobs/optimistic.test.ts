import { applyPatchToList, optimisticPatch } from './optimistic';
import { JobSuperStatus, type Deal } from './types';

const NOW = '2026-09-16T13:04:00.000Z';

describe('optimisticPatch', () => {
  it('stamps a confirmation with the technician who tapped it', () => {
    expect(optimisticPatch('confirm', {}, NOW, 't1')).toEqual({
      techConfirmedAt: NOW,
      techConfirmedBy: 't1',
    });
  });

  it('stamps an arrival, carrying the fix when the phone gave one', () => {
    expect(
      optimisticPatch('arrived', { lat: 41.76, lng: -72.67, accuracy: 8 }, NOW, 't1'),
    ).toEqual({
      arrivedAt: NOW,
      arrivedBy: 't1',
      arrivedLocation: { lat: 41.76, lng: -72.67, accuracy: 8 },
    });
  });

  it('stamps an arrival with no fix at all — the server accepts an empty body', () => {
    expect(optimisticPatch('arrived', {}, NOW, 't1')).toEqual({
      arrivedAt: NOW,
      arrivedBy: 't1',
    });
  });

  it('leaves out an accuracy the phone could not give', () => {
    expect(optimisticPatch('arrived', { lat: 1, lng: 2 }, NOW)).toEqual({
      arrivedAt: NOW,
      arrivedLocation: { lat: 1, lng: 2 },
    });
  });

  it('moves the status and re-stamps when it changed', () => {
    expect(
      optimisticPatch('status', { superStatus: JobSuperStatus.IN_PROGRESS }, NOW),
    ).toEqual({
      superStatus: JobSuperStatus.IN_PROGRESS,
      subStatusId: undefined,
      statusChangedAt: NOW,
    });
  });

  it('changes nothing visible for a note or an automatic text', () => {
    expect(optimisticPatch('note', { note: 'Gate code 4821' }, NOW)).toEqual({});
    expect(optimisticPatch('on_my_way', { etaMinutes: 15 }, NOW)).toEqual({});
    expect(optimisticPatch('late', { minutes: 30 }, NOW)).toEqual({});
  });
});

describe('applyPatchToList', () => {
  const list: Deal[] = [
    {
      id: 'd1',
      dealNumber: 'A',
      contactId: 'c',
      address: { street: '', city: '', state: '', zip: '' },
      superStatus: JobSuperStatus.SUBMITTED,
    },
    {
      id: 'd2',
      dealNumber: 'B',
      contactId: 'c',
      address: { street: '', city: '', state: '', zip: '' },
      superStatus: JobSuperStatus.SUBMITTED,
    },
  ];

  it('patches only the job it names', () => {
    const next = applyPatchToList(list, 'd2', { arrivedAt: NOW })!;
    expect(next[0]!.arrivedAt).toBeUndefined();
    expect(next[1]!.arrivedAt).toBe(NOW);
  });

  it('returns the very same list when the job is not on it', () => {
    // Identity matters: a new array re-renders every card on a day the job is
    // not even part of.
    expect(applyPatchToList(list, 'nope', { arrivedAt: NOW })).toBe(list);
  });

  it('copes with a list that has not loaded yet', () => {
    expect(applyPatchToList(undefined, 'd1', {})).toBeUndefined();
  });
});

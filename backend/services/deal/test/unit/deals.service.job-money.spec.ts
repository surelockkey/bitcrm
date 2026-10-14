import { BadRequestException } from '@nestjs/common';
import { DealsService } from 'src/deals/deals.service';

/**
 * The quick view's Finance box (Workiz): Total is typed by hand only while
 * the job has no line items — once it has, the items price it and the box is
 * read-only; Tech Cost and Company Cost are two plain job-level amounts.
 */
const base = {
  id: 'd1',
  dealNumber: 'AB12CD',
  contactId: 'c1',
  itemCount: 0,
  assignedTechIds: [],
  tagIds: [],
};

function make(deal: Record<string, unknown>) {
  const repository = {
    findById: jest.fn(async () => deal),
    update: jest.fn(async (_id: string, attrs: Record<string, unknown>) => ({ ...deal, ...attrs })),
  };
  const cache = { get: jest.fn(async () => null), set: jest.fn(), invalidate: jest.fn() };
  const timeline = { addEntry: jest.fn() };
  const none = {} as never;
  const service = new DealsService(
    repository as never, cache as never, timeline as never,
    none, none, none, none, none, none, none, none, none, none, none,
  );
  return { service, repository, timeline };
}

const caller = { id: 'u1', email: 'dispatcher@example.com' } as never;
const entryFor = (timeline: { addEntry: jest.Mock }, field: string) =>
  timeline.addEntry.mock.calls.map((c) => c[0].details).find((d) => d.field === field);

describe('job money on PUT /deals/:id', () => {
  it('a typed total on a job without lines becomes its totals snapshot, flagged manual', async () => {
    const { service, repository, timeline } = make({ ...base, itemCount: 0 });
    await service.update('d1', { total: 150 } as never, caller);
    const attrs = repository.update.mock.calls[0][1];
    expect(attrs.totals).toEqual(expect.objectContaining({ total: 150, subtotal: 150, manual: true }));
    expect(attrs).not.toHaveProperty('total');
    expect(entryFor(timeline, 'total')).toEqual(expect.objectContaining({ oldValue: null, newValue: 150 }));
    expect(entryFor(timeline, 'totals')).toBeUndefined();
  });

  it('refuses a typed total once the job has line items', async () => {
    const { service, repository } = make({ ...base, itemCount: 2, totals: { total: 286.4 } });
    await expect(service.update('d1', { total: 150 } as never, caller)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('the same total again is no change', async () => {
    const { service, timeline } = make({ ...base, totals: { subtotal: 150, discount: 0, tax: 0, total: 150, cost: 0, manual: true } });
    await service.update('d1', { total: 150 } as never, caller);
    expect(entryFor(timeline, 'total')).toBeUndefined();
  });

  it('tech cost and company cost are written as given and logged by name', async () => {
    const { service, repository, timeline } = make({ ...base, techCost: 10 });
    await service.update('d1', { techCost: 20, companyCost: 5 } as never, caller);
    const attrs = repository.update.mock.calls[0][1];
    expect(attrs).toEqual(expect.objectContaining({ techCost: 20, companyCost: 5 }));
    expect(entryFor(timeline, 'techCost')).toEqual(expect.objectContaining({ oldValue: 10, newValue: 20 }));
    expect(entryFor(timeline, 'companyCost')).toEqual(expect.objectContaining({ oldValue: null, newValue: 5 }));
  });
});

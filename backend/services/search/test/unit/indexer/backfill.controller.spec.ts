import { BackfillController } from 'src/indexer/backfill/backfill.controller';

describe('BackfillController', () => {
  it('starts a fire-and-forget backfill and returns 202-accepted', async () => {
    let resolveRun: (v: any) => void;
    const run = jest.fn().mockReturnValue(new Promise((r) => { resolveRun = r; }));
    const ctrl = new BackfillController({ run } as any);

    const res = ctrl.reindex();
    expect(res.accepted).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    // a second call while the first is running is rejected (no double-scan)
    expect(ctrl.reindex().accepted).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    resolveRun!({});
    await new Promise((r) => setImmediate(r));

    // after completion, a new run is allowed again
    run.mockResolvedValueOnce({});
    expect(ctrl.reindex().accepted).toBe(true);
  });
});

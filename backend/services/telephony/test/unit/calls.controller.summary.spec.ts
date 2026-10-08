import { CallsController } from '../../src/calls/calls.controller';
import { type CallsService } from '../../src/calls/calls.service';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';

/**
 * `GET /calls/stats/summary` — the cards over the log — and `GET /calls/count`
 * take the list's query string through one parser, so the cards, "of N" and
 * the rows always describe the same calls. Money only with financials.view.
 */

const USER = { id: 'disp-1' } as JwtUser;

function makeController(over: Record<string, unknown> = {}) {
  const calls = {
    count: jest.fn().mockResolvedValue({ total: 7, atLeast: false }),
    summary: jest.fn().mockResolvedValue({ calls: 7, callers: 5, missed: 2, active: 0, jobs: 1, atLeast: false }),
    ...over,
  } as unknown as CallsService;
  const permissions = { maySeeClientNumbers: jest.fn().mockResolvedValue(true) };
  const none = {} as never;
  const controller = new CallsController(
    calls,
    none, none, none, none, none, none,
    permissions as never,
    none, none,
    {} as never,
  );
  return { controller, calls, permissions };
}

const perms = (financials: boolean): { resolvedPermissions: ResolvedPermissions } => ({
  resolvedPermissions: {
    permissions: { calls: { view: true }, financials: { view: financials } },
    dataScope: {},
  } as unknown as ResolvedPermissions,
});

describe('CallsController.summary', () => {
  it('answers the cards for the same filters as the list', async () => {
    const { controller, calls } = makeController();

    const out = await controller.summary(
      { status: 'missed,busy', agentId: 'u1,u2', dateFrom: '2026-10-08T04:00:00.000Z', dateTo: '2026-10-09T03:59:59.999Z', limit: '10' },
      USER,
      perms(false),
    );

    expect(out).toEqual({ success: true, data: { calls: 7, callers: 5, missed: 2, active: 0, jobs: 1, atLeast: false } });
    expect((calls.summary as jest.Mock).mock.calls[0][0]).toEqual({
      status: 'missed,busy',
      agentId: 'u1,u2',
      dateFrom: '2026-10-08T04:00:00.000Z',
      dateTo: '2026-10-09T03:59:59.999Z',
    });
  });

  it('asks for revenue only for a viewer with financials.view', async () => {
    const { controller, calls } = makeController();

    await controller.summary({}, USER, perms(false));
    await controller.summary({}, USER, perms(true));

    expect((calls.summary as jest.Mock).mock.calls[0][1]).toEqual({ withRevenue: false });
    expect((calls.summary as jest.Mock).mock.calls[1][1]).toEqual({ withRevenue: true });
  });

  it('never hands revenue to a viewer without the grant, whatever the service returned', async () => {
    const { controller } = makeController({
      summary: jest.fn().mockResolvedValue({ calls: 1, callers: 1, missed: 0, active: 0, jobs: 1, revenue: 99, atLeast: false }),
    });

    const out = await controller.summary({}, USER, perms(false));

    expect(out.data).not.toHaveProperty('revenue');
  });
});

describe('CallsController.count', () => {
  it('takes the same query string as the list', async () => {
    const { controller, calls } = makeController();

    const out = await controller.count({ direction: 'inbound,outbound', tagId: 't1', cursor: 'c', limit: '10', masked: 'true' }, USER);

    expect(out).toEqual({ success: true, data: { total: 7, atLeast: false } });
    expect((calls.count as jest.Mock).mock.calls[0][0]).toEqual({ direction: 'inbound,outbound', tagId: 't1', masked: true });
  });
});

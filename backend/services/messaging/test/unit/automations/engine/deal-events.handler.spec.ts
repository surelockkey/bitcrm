import {
  AutomationDealEventsHandler,
  callOutcome,
} from '../../../../src/automations/engine/deal-events.handler';
import { AutomationRuleEngine } from '../../../../src/automations/engine/rule-engine.service';

const DEAL = {
  id: 'd1',
  contactId: 'ct1',
  superStatus: 'submitted',
  assignedTechIds: ['t1'],
  tagIds: [],
  scheduledDate: '2026-09-20',
  scheduledTimeSlot: '09:00-11:00',
};

function harness(over: Record<string, any> = {}) {
  const newJobSms = { onTechAssigned: jest.fn(async () => undefined), onDealUpdated: jest.fn(async () => undefined) };
  const engine = {
    handle: jest.fn(async () => []),
    dealFacts: AutomationRuleEngine.prototype.dealFacts,
    ...(over.engine ?? {}),
  };
  const peers = { deal: jest.fn(async () => DEAL), ...(over.peers ?? {}) };
  const snapshots = {
    get: jest.fn(async () => null),
    put: jest.fn(async () => undefined),
    ...(over.snapshots ?? {}),
  };
  const handler = new AutomationDealEventsHandler(newJobSms as any, engine as any, peers as any, snapshots as any);
  return { handler, newJobSms, engine, peers, snapshots };
}

describe('AutomationDealEventsHandler', () => {
  it('runs the built-in New-job SMS first, then the rules', async () => {
    const { handler, newJobSms, engine } = harness();
    const payload = { dealId: 'd1', techId: 't1', assignedBy: 'u1' };
    await handler.onTechAssigned(payload);

    expect(newJobSms.onTechAssigned).toHaveBeenCalledWith(payload);
    expect(newJobSms.onTechAssigned.mock.invocationCallOrder[0]).toBeLessThan(
      engine.handle.mock.invocationCallOrder[0],
    );
    expect(engine.handle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'deal.tech_assigned', dealId: 'd1', techId: 't1' }),
      expect.objectContaining({ deal: expect.objectContaining({ id: 'd1' }) }),
    );
  });

  it('reads the job once and hands the same facts to the engine', async () => {
    const { handler, peers } = harness();
    await handler.onDealUpdated({ dealId: 'd1' });
    expect(peers.deal).toHaveBeenCalledTimes(1);
  });

  it('passes the status change through with the ids the event carries', async () => {
    const { handler, engine } = harness();
    await handler.onDealStatusChanged({ dealId: 'd1', oldStatus: 'submitted', newStatus: 'done' });
    expect(engine.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'deal.status_changed',
        status: expect.objectContaining({ from: 'submitted', to: 'done' }),
      }),
      expect.anything(),
    );
  });

  it('raises a synthetic reschedule when the job date moved since we last saw it', async () => {
    const { handler, engine, snapshots } = harness({
      snapshots: {
        get: jest.fn(async () => ({
          dealId: 'd1',
          scheduledDate: '2026-09-18',
          scheduledTimeSlot: '09:00-11:00',
          seenAt: '2026-09-15T10:00:00.000Z',
        })),
        put: jest.fn(async () => undefined),
      },
    });
    await handler.onDealUpdated({ dealId: 'd1' });

    expect(snapshots.put).toHaveBeenCalledWith(expect.objectContaining({ dealId: 'd1', scheduledDate: '2026-09-20' }));
    expect(engine.handle).toHaveBeenCalledTimes(2);
    expect(engine.handle.mock.calls[0][0]).toMatchObject({
      kind: 'deal.scheduled_changed',
      schedule: { fromDate: '2026-09-18', toDate: '2026-09-20' },
    });
    expect(engine.handle.mock.calls[1][0]).toMatchObject({ kind: 'deal.updated' });
  });

  it('raises nothing extra the first time a job is seen', async () => {
    const { handler, engine } = harness();
    await handler.onDealCreated({ dealId: 'd1' });
    expect(engine.handle).toHaveBeenCalledTimes(1);
    expect(engine.handle.mock.calls[0][0]).toMatchObject({ kind: 'deal.created' });
  });

  it('still dispatches when the snapshot store is unavailable', async () => {
    const { handler, engine } = harness({
      snapshots: { get: jest.fn(async () => { throw new Error('table down'); }), put: jest.fn() },
    });
    await handler.onDealUpdated({ dealId: 'd1' });
    expect(engine.handle).toHaveBeenCalledTimes(1);
  });

  it('accepts a real deal.scheduled_changed if deal-service ever publishes one', async () => {
    const { handler, engine } = harness();
    await handler.onScheduledChanged({
      dealId: 'd1',
      from: { scheduledDate: '2026-09-18' },
      to: { scheduledDate: '2026-09-20' },
    });
    expect(engine.handle).toHaveBeenCalledTimes(1);
    expect(engine.handle.mock.calls[0][0]).toMatchObject({
      kind: 'deal.scheduled_changed',
      schedule: { fromDate: '2026-09-18', toDate: '2026-09-20' },
    });
  });

  it('drops a payload without a job id', async () => {
    const { handler, engine } = harness();
    await handler.onDealCreated({});
    await handler.onDealStatusChanged(null);
    expect(engine.handle).not.toHaveBeenCalled();
  });

  it('turns a call into its outcome and facts', async () => {
    const { handler, engine } = harness();
    await handler.onCallCompleted({
      callSid: 'CA1',
      direction: 'inbound',
      status: 'no-answer',
      startedAt: '2026-09-16T14:00:00.000Z',
      endedAt: '2026-09-16T14:00:30.000Z',
    });
    expect(engine.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'call.completed',
        at: '2026-09-16T14:00:30.000Z',
        call: { sid: 'CA1', outcome: 'missed', direction: 'inbound' },
      }),
      expect.objectContaining({ call: expect.objectContaining({ callSid: 'CA1', status: 'no-answer' }) }),
    );
  });
});

describe('callOutcome', () => {
  it('maps the Twilio terminal statuses', () => {
    expect(callOutcome('completed')).toBe('answered');
    expect(callOutcome('no-answer')).toBe('missed');
    expect(callOutcome('busy')).toBe('missed');
    expect(callOutcome('failed')).toBe('missed');
    expect(callOutcome('completed', true)).toBe('voicemail');
    expect(callOutcome(undefined)).toBe('missed');
  });
});

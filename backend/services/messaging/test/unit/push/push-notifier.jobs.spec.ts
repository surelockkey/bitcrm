import { PushNotifier } from '../../../src/push/push-notifier.service';
import { type RenderContext } from '../../../src/templates/render-context';

const TECH = { status: 'active', roleId: 'role-technician' };
const USERS: Record<string, Record<string, unknown>> = {
  t1: { id: 't1', ...TECH },
  t2: { id: 't2', ...TECH },
  owner: { id: 'owner', status: 'active', roleId: 'role-admin', fieldTeamMember: true },
  office: { id: 'office', status: 'active', roleId: 'role-admin', fieldTeamMember: false },
  sub: { id: 'sub', ...TECH, userType: 'subcontractor' },
  gone: { id: 'gone', ...TECH, status: 'inactive' },
  quiet: { id: 'quiet', ...TECH },
};
const TOKENS: Record<string, string[]> = {
  t1: ['ExponentPushToken[t1-phone]', 'ExponentPushToken[t1-tablet]'],
  t2: ['ExponentPushToken[t2]'],
  owner: ['ExponentPushToken[owner]'],
  office: ['ExponentPushToken[office]'],
  sub: ['ExponentPushToken[sub]'],
  gone: ['ExponentPushToken[gone]'],
};

function jobCtx(deal: RenderContext['deal'] = {}): RenderContext {
  return {
    deal: {
      id: 'd1',
      dealNumber: '1042',
      jobTypeName: 'Lockout',
      scheduledDate: '2026-10-16',
      scheduledTimeSlot: '10:00-12:00',
      assignedTechIds: ['t1', 't2'],
      superStatus: 'submitted',
      status: 'active',
      ...deal,
    },
    contact: { firstName: 'Jane', lastName: 'Doe' },
    timezone: 'America/Chicago',
  };
}

function harness(opts: { ctx?: RenderContext | null; enabled?: boolean; claim?: boolean } = {}) {
  const repository = {
    claim: jest.fn(async () => opts.claim ?? true),
    tokensFor: jest.fn(async (userId: string) =>
      (TOKENS[userId] ?? []).map((token) => ({ token, userId, platform: 'ios', createdAt: 'x', updatedAt: 'x' })),
    ),
    unregister: jest.fn(async () => undefined),
  };
  const expo = { send: jest.fn(async (messages: unknown[]) => messages.map((_, i) => ({ status: 'ok', id: `ticket-${i}` }))) };
  const peers = { user: jest.fn(async (id: string) => USERS[id] ?? null) };
  const context = { load: jest.fn(async () => (opts.ctx === undefined ? jobCtx() : opts.ctx ?? {})) };
  const notifier = new PushNotifier(
    { enabled: opts.enabled ?? true },
    repository as any,
    expo as any,
    peers as any,
    context as any,
  );
  const sent = () => (expo.send.mock.calls.flatMap((c) => c[0]) as Array<{ to: string; title: string; body: string; data: unknown }>);
  return { notifier, repository, expo, peers, context, sent };
}

describe('PushNotifier — deal.tech_assigned', () => {
  it('pushes "New job assigned" to every device of the newly assigned technician', async () => {
    const { notifier, sent, context, repository } = harness();

    const result = await notifier.onTechAssigned({ dealId: 'd1', techId: 't1', assignedBy: 'disp' }, { eventId: 'evt-1' });

    expect(context.load).toHaveBeenCalledWith({ dealId: 'd1' });
    expect(repository.claim).toHaveBeenCalledWith('job_assigned#evt-1');
    expect(sent()).toEqual([
      expect.objectContaining({ to: 'ExponentPushToken[t1-phone]' }),
      expect.objectContaining({ to: 'ExponentPushToken[t1-tablet]' }),
    ]);
    expect(sent()[0]).toEqual({
      to: 'ExponentPushToken[t1-phone]',
      title: 'New job assigned',
      body: 'Lockout #1042 · Jane Doe · Fri Oct 16, 10:00 AM CDT',
      data: { type: 'job_assigned', dealId: 'd1' },
      sound: 'default',
      priority: 'high',
    });
    expect(result.recipients).toEqual({ t1: 'sent' });
  });

  it('an SQS redelivery of the same event pushes nothing (the claim is taken)', async () => {
    const { notifier, expo, context } = harness({ claim: false });
    const result = await notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'evt-1' });
    expect(result.skipped).toBe('duplicate');
    expect(context.load).not.toHaveBeenCalled();
    expect(expo.send).not.toHaveBeenCalled();
  });

  it('skips a technician who is no longer on the job, a closed or deleted job, a job nobody can read, and self-assignment', async () => {
    expect((await harness({ ctx: jobCtx({ assignedTechIds: ['t2'] }) }).notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).skipped).toBe('not_on_roster');
    expect((await harness({ ctx: jobCtx({ superStatus: 'canceled' }) }).notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).skipped).toBe('closed_deal');
    expect((await harness({ ctx: jobCtx({ superStatus: 'done' }) }).notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).skipped).toBe('closed_deal');
    expect((await harness({ ctx: jobCtx({ status: 'deleted' }) }).notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).skipped).toBe('closed_deal');
    expect((await harness({ ctx: null }).notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).skipped).toBe('no_deal');
    const self = harness();
    expect((await self.notifier.onTechAssigned({ dealId: 'd1', techId: 't1', assignedBy: 't1' }, { eventId: 'e' })).skipped).toBe('no_recipients');
    expect(self.expo.send).not.toHaveBeenCalled();
  });

  it('never pushes to a subcontractor, an inactive user, an office user, an unknown user or one with no device', async () => {
    for (const techId of ['sub', 'gone', 'office', 'nobody', 'quiet']) {
      const { notifier, expo, sent } = harness({ ctx: jobCtx({ assignedTechIds: [techId] }) });
      const result = await notifier.onTechAssigned({ dealId: 'd1', techId }, { eventId: `e-${techId}` });
      expect(sent()).toEqual([]);
      expect(expo.send).not.toHaveBeenCalled();
      expect(result.recipients[techId]).toEqual(
        { sub: 'subcontractor', gone: 'inactive', office: 'not_field_team', nobody: 'unknown_user', quiet: 'no_tokens' }[techId],
      );
    }
  });

  it('an owner on the field team is a technician for this', async () => {
    const { notifier, sent } = harness({ ctx: jobCtx({ assignedTechIds: ['owner'] }) });
    await notifier.onTechAssigned({ dealId: 'd1', techId: 'owner' }, { eventId: 'e' });
    expect(sent().map((m) => m.to)).toEqual(['ExponentPushToken[owner]']);
  });

  it('drops a malformed payload and does nothing while switched off', async () => {
    expect((await harness().notifier.onTechAssigned({ dealId: 'd1' }, { eventId: 'e' })).skipped).toBe('malformed');
    const off = harness({ enabled: false });
    expect((await off.notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).skipped).toBe('disabled');
    expect(off.repository.claim).not.toHaveBeenCalled();
    expect(off.context.load).not.toHaveBeenCalled();
  });

  it('without an event id it still pushes, unguarded', async () => {
    const { notifier, repository, sent } = harness();
    await notifier.onTechAssigned({ dealId: 'd1', techId: 't2' });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(sent().map((m) => m.to)).toEqual(['ExponentPushToken[t2]']);
  });
});

describe('PushNotifier — deal.status_changed to Canceled', () => {
  it('pushes "Job canceled" to every technician on the job except whoever canceled it', async () => {
    const { notifier, sent, repository } = harness({ ctx: jobCtx({ superStatus: 'canceled' }) });
    await notifier.onStatusChanged({ dealId: 'd1', oldStatus: 'submitted', newStatus: 'canceled', changedBy: 't2' }, { eventId: 'evt-9' });

    expect(repository.claim).toHaveBeenCalledWith('job_canceled#evt-9');
    expect(sent().map((m) => m.to)).toEqual(['ExponentPushToken[t1-phone]', 'ExponentPushToken[t1-tablet]']);
    expect(sent()[0]).toMatchObject({ title: 'Job canceled', body: '#1042 · Jane Doe', data: { type: 'job_canceled', dealId: 'd1' } });
  });

  it('other moves, and a cancel already reversed by the time we read the job, push nothing', async () => {
    const done = harness({ ctx: jobCtx({ superStatus: 'done' }) });
    expect((await done.notifier.onStatusChanged({ dealId: 'd1', oldStatus: 'in_progress', newStatus: 'done' }, { eventId: 'e' })).skipped).toBe('not_canceled');
    expect(done.repository.claim).not.toHaveBeenCalled();
    const reopened = harness({ ctx: jobCtx({ superStatus: 'submitted' }) });
    expect((await reopened.notifier.onStatusChanged({ dealId: 'd1', oldStatus: 'submitted', newStatus: 'canceled' }, { eventId: 'e' })).skipped).toBe('not_canceled');
    expect(reopened.expo.send).not.toHaveBeenCalled();
  });
});

describe('PushNotifier — deal.tech_unassigned', () => {
  it('pushes "Removed from job" to the technician taken off it', async () => {
    const { notifier, sent, repository } = harness({ ctx: jobCtx({ assignedTechIds: ['t2'] }) });
    await notifier.onTechUnassigned({ dealId: 'd1', techId: 't1', unassignedBy: 'disp' }, { eventId: 'evt-3' });

    expect(repository.claim).toHaveBeenCalledWith('job_unassigned#evt-3');
    expect(sent()[0]).toMatchObject({ title: 'Removed from job', body: '#1042', data: { type: 'job_unassigned', dealId: 'd1' } });
    expect(sent()).toHaveLength(2);
  });

  it('not when they are back on it, took themselves off, or the job is closed', async () => {
    expect((await harness().notifier.onTechUnassigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).skipped).toBe('still_on_roster');
    expect((await harness({ ctx: jobCtx({ assignedTechIds: [] }) }).notifier.onTechUnassigned({ dealId: 'd1', techId: 't1', unassignedBy: 't1' }, { eventId: 'e' })).skipped).toBe('no_recipients');
    expect((await harness({ ctx: jobCtx({ assignedTechIds: [], superStatus: 'done' }) }).notifier.onTechUnassigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).skipped).toBe('closed_deal');
  });
});

describe('PushNotifier — reschedule (detected from the DEALSNAP# snapshot)', () => {
  const previous = { dealId: 'd1', scheduledDate: '2026-10-15', scheduledTimeSlot: '10:00-12:00', seenAt: 'x' };
  const next = { dealId: 'd1', scheduledDate: '2026-10-16', scheduledTimeSlot: '10:00-12:00', seenAt: 'y' };

  it('pushes "Job rescheduled" with the new time to every technician on the job except whoever moved it', async () => {
    const { notifier, sent, repository } = harness();
    await notifier.onRescheduled({ dealId: 'd1', previous, next, eventId: 'evt-5', actorId: 't2' });

    expect(repository.claim).toHaveBeenCalledWith('job_rescheduled#evt-5');
    expect(sent().map((m) => m.to)).toEqual(['ExponentPushToken[t1-phone]', 'ExponentPushToken[t1-tablet]']);
    expect(sent()[0]).toMatchObject({
      title: 'Job rescheduled',
      body: '#1042 moved to Fri Oct 16, 10:00 AM CDT',
      data: { type: 'job_rescheduled', dealId: 'd1' },
    });
  });

  it('a new start time on the same day counts; only the end moving (a close stamps it) does not', async () => {
    const later = harness();
    await later.notifier.onRescheduled({ dealId: 'd1', previous, next: { ...previous, scheduledTimeSlot: '13:00-15:00' }, eventId: 'e' });
    expect(later.expo.send).toHaveBeenCalled();

    const endOnly = harness();
    const result = await endOnly.notifier.onRescheduled({
      dealId: 'd1',
      previous,
      next: { ...previous, scheduledEndDate: '2026-10-20', scheduledTimeSlot: '10:00-18:00' },
      eventId: 'e',
    });
    expect(result.skipped).toBe('not_rescheduled');
    expect(endOnly.repository.claim).not.toHaveBeenCalled();
  });

  it('a closed job is not "rescheduled"', async () => {
    const { notifier, expo } = harness({ ctx: jobCtx({ superStatus: 'done' }) });
    expect((await notifier.onRescheduled({ dealId: 'd1', previous, next, eventId: 'e' })).skipped).toBe('closed_deal');
    expect(expo.send).not.toHaveBeenCalled();
  });
});

describe('PushNotifier — delivery', () => {
  it('forgets a token Expo reports as DeviceNotRegistered, and only that one', async () => {
    const { notifier, expo, repository } = harness();
    expo.send.mockImplementationOnce(async () => [
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      { status: 'ok', id: 'x' },
    ] as any);

    const result = await notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' });

    expect(repository.unregister).toHaveBeenCalledTimes(1);
    expect(repository.unregister).toHaveBeenCalledWith('t1', 'ExponentPushToken[t1-phone]');
    expect(result.recipients).toEqual({ t1: 'sent' });
  });

  it('a recipient whose every device failed is reported failed', async () => {
    const { notifier, expo } = harness();
    expo.send.mockImplementationOnce(async (messages: unknown[]) => messages.map(() => ({ status: 'error', message: 'Expo answered 503' })) as any);
    expect((await notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).recipients).toEqual({ t1: 'failed' });
  });

  it('never throws back to the event consumer — a table, peer or sender failure is logged and dropped', async () => {
    const claimDown = harness();
    claimDown.repository.claim.mockRejectedValueOnce(new Error('throttled'));
    await expect(claimDown.notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).resolves.toMatchObject({ skipped: 'failed' });

    const contextDown = harness();
    contextDown.context.load.mockRejectedValueOnce(new Error('boom'));
    await expect(contextDown.notifier.onStatusChanged({ dealId: 'd1', newStatus: 'canceled' }, { eventId: 'e' })).resolves.toMatchObject({ skipped: 'failed' });

    const senderDown = harness();
    senderDown.expo.send.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(senderDown.notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).resolves.toMatchObject({ skipped: 'failed' });

    const tokensDown = harness();
    tokensDown.repository.tokensFor.mockRejectedValueOnce(new Error('throttled'));
    await expect(tokensDown.notifier.onRescheduled({
      dealId: 'd1',
      previous: { dealId: 'd1', scheduledDate: '2026-10-15', seenAt: 'x' },
      next: { dealId: 'd1', scheduledDate: '2026-10-16', seenAt: 'y' },
      eventId: 'e',
    })).resolves.toBeDefined();
    // The other technician still got theirs.
    expect(tokensDown.expo.send).toHaveBeenCalled();

    const cleanupDown = harness();
    cleanupDown.expo.send.mockImplementationOnce(async () => [{ status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'ok', id: 'x' }] as any);
    cleanupDown.repository.unregister.mockRejectedValueOnce(new Error('throttled'));
    await expect(cleanupDown.notifier.onTechAssigned({ dealId: 'd1', techId: 't1' }, { eventId: 'e' })).resolves.toMatchObject({ recipients: { t1: 'sent' } });
  });
});

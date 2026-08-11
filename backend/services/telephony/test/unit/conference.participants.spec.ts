import { makeHarness } from './helpers/conference-harness';

describe('ConferenceService — participant tracking', () => {
  it('records the caller on an outbound call', async () => {
    const { service, records } = makeHarness();
    await service.initOutbound('CAout', 'agent-A', '+380958601427', '+15412830739');

    const parts = records.get('CAout')?.participants;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ userId: 'agent-A', role: 'caller' });
    expect(parts[0].at).toBeDefined();
  });

  it('records the answering agent on an inbound win', async () => {
    const { service, records } = makeHarness();
    await service.initInbound('CAin', '+380958601427', '+15412830739', ['agent-B']);
    await service.claimWinner('conf-CAin', 'CAleg-agent-B');
    await service.onWinner('conf-CAin', 'CAleg-agent-B', 'agent-B');

    const parts = records.get('CAin')?.participants;
    expect(parts).toEqual([
      expect.objectContaining({ userId: 'agent-B', role: 'answered' }),
    ]);
  });

  it('records who listened vs joined via monitor', async () => {
    const { service, records } = makeHarness();
    await service.initOutbound('CAout', 'agent-A', '+380958601427', '+15412830739');
    await service.recordMonitorParticipant('conf-CAout', 'boss-1', 'listen');
    await service.recordMonitorParticipant('conf-CAout', 'boss-2', 'join');

    const roles = records
      .get('CAout')
      ?.participants.map((p: any) => `${p.userId}:${p.role}`);
    expect(roles).toEqual(['agent-A:caller', 'boss-1:listened', 'boss-2:joined']);
  });
});

describe('ConferenceService — internal (our-number-to-our-number) calls', () => {
  it('findLinkedOutbound matches the live outbound leg by from/to', async () => {
    const { service } = makeHarness();
    await service.initOutbound('CAout', 'agent-A', '+15412830739', '+15559998888');
    expect(await service.findLinkedOutbound('+15559998888', '+15412830739')).toBe(
      'CAout',
    );
    expect(await service.findLinkedOutbound('+15550000000', '+15412830739')).toBeUndefined();
  });

  it('links the receiving record and surfaces the answerer on the visible one', async () => {
    const { service, records } = makeHarness();
    // agent-A dials our other number from number X
    await service.initOutbound('CAout', 'agent-A', '+15412830739', '+15559998888');
    // the receiving side arrives as inbound, linked to CAout
    await service.initInbound(
      'CAin', '+15559998888', '+15412830739', ['agent-B'], 'CAout',
    );
    expect(records.get('CAin')?.internalLegOf).toBe('CAout');

    await service.claimWinner('conf-CAin', 'CAleg-agent-B');
    await service.onWinner('conf-CAin', 'CAleg-agent-B', 'agent-B');

    // ONE visible call showing both users: A called, B answered.
    const visible = records.get('CAout');
    const roles = visible?.participants.map((p: any) => `${p.userId}:${p.role}`);
    expect(roles).toEqual(['agent-A:caller', 'agent-B:answered']);
    expect(visible?.answeredAt).toBeDefined();
    // the hidden leg keeps its own bookkeeping
    expect(records.get('CAin')?.participants).toEqual([
      expect.objectContaining({ userId: 'agent-B', role: 'answered' }),
    ]);
  });
});

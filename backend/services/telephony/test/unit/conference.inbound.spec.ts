import { makeHarness } from './helpers/conference-harness';

describe('ConferenceService — inbound flow', () => {
  async function startInbound(h = makeHarness()) {
    await h.service.initInbound(
      'CAcust1',
      '+380958601427',
      '+12624061115',
      ['agent-1', 'agent-2'],
    );
    return h;
  }

  it('creates one ring leg per online agent via the agent-join webhook', async () => {
    const { twilio, applied, callsService } = await startInbound();

    expect(twilio.callsCreate).toHaveBeenCalledTimes(2);
    const first = twilio.callsCreate.mock.calls[0][0];
    expect(first.to).toBe('client:agent-1');
    // caller id = the customer's number so the softphone screen-pop works
    expect(first.from).toBe('+380958601427');
    expect(first.url).toContain('/api/telephony/voice/agent-join?conf=conf-CAcust1');
    expect(first.timeout).toBe(25);
    expect(first.statusCallback).toContain(
      '/api/telephony/voice/status?conf=conf-CAcust1&role=agent',
    );

    expect(applied[0]).toMatchObject({
      callSid: 'CAcust1',
      direction: 'inbound',
      from: '+380958601427',
      to: '+12624061115',
      status: 'ringing',
      conferenceName: 'conf-CAcust1',
    });
    expect(callsService.appendChildSid).toHaveBeenCalledWith('CAcust1', 'CAleg-agent-1');
    expect(callsService.appendChildSid).toHaveBeenCalledWith('CAcust1', 'CAleg-agent-2');
  });

  it('claimWinner: first claim wins, the second is a loser', async () => {
    const { service } = await startInbound();
    expect(await service.claimWinner('conf-CAcust1', 'CAleg-agent-1')).toBe('winner');
    expect(await service.claimWinner('conf-CAcust1', 'CAleg-agent-2')).toBe('loser');
  });

  it('onWinner records the answering agent and cancels still-ringing siblings', async () => {
    const h = await startInbound();
    await h.service.claimWinner('conf-CAcust1', 'CAleg-agent-1');
    await h.service.onWinner('conf-CAcust1', 'CAleg-agent-1', 'agent-1');

    const update = h.applied.at(-1);
    expect(update).toMatchObject({ callSid: 'CAcust1', agentId: 'agent-1' });
    expect(update.answeredAt).toBeDefined();
    // sibling leg (agent-2) canceled best-effort; winner's leg untouched
    expect(h.twilio.callUpdate).toHaveBeenCalledWith({ status: 'completed' });
  });

  it('when every agent leg ends without a winner, the customer is redirected and the record is no-answer', async () => {
    const h = await startInbound();
    await h.service.onLegStatus('conf-CAcust1', 'agent', {
      CallSid: 'CAleg-agent-1',
      CallStatus: 'no-answer',
    });
    // one still pending — customer keeps waiting
    expect(h.twilio.callUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ twiml: expect.stringContaining('no agents') }),
    );

    await h.service.onLegStatus('conf-CAcust1', 'agent', {
      CallSid: 'CAleg-agent-2',
      CallStatus: 'no-answer',
    });

    // customer leg redirected to the goodbye message
    const redirect = h.twilio.callUpdate.mock.calls.find(
      (c: any[]) => typeof c[0]?.twiml === 'string',
    );
    expect(redirect).toBeDefined();
    expect(redirect![0].twiml).toContain('no agents are available');
    expect(h.applied.at(-1)).toMatchObject({ callSid: 'CAcust1', status: 'no-answer' });
  });

  it('an agent-leg failure after a winner exists does NOT redirect the customer', async () => {
    const h = await startInbound();
    await h.service.claimWinner('conf-CAcust1', 'CAleg-agent-1');
    await h.service.onWinner('conf-CAcust1', 'CAleg-agent-1', 'agent-1');
    h.twilio.callUpdate.mockClear();

    await h.service.onLegStatus('conf-CAcust1', 'agent', {
      CallSid: 'CAleg-agent-2',
      CallStatus: 'canceled',
    });
    expect(h.twilio.callUpdate).not.toHaveBeenCalled();
  });
});

describe('ConferenceService — monitor grants', () => {
  it('grants are single-use and mode-preserving', async () => {
    const { service } = makeHarness();
    await service.grantMonitor('sup-1', 'conf-CAcust1', 'listen');
    expect(await service.consumeMonitorGrant('sup-1', 'conf-CAcust1')).toBe('listen');
    // consumed — second read is empty
    expect(await service.consumeMonitorGrant('sup-1', 'conf-CAcust1')).toBeNull();
  });

  it('grants are scoped per user', async () => {
    const { service } = makeHarness();
    await service.grantMonitor('sup-1', 'conf-CAcust1', 'join');
    expect(await service.consumeMonitorGrant('sup-2', 'conf-CAcust1')).toBeNull();
  });

  it('isConferenceLive reflects the Twilio conference status', async () => {
    const h = makeHarness();
    expect(await h.service.isConferenceLive('CF123')).toBe(true);
    h.twilio.conferenceFetch.mockResolvedValueOnce({ status: 'completed' });
    expect(await h.service.isConferenceLive('CF123')).toBe(false);
  });
});

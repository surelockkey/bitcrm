import { makeHarness } from './helpers/conference-harness';

describe('ConferenceService — outbound flow', () => {
  it('initOutbound stashes context and creates the record as initiated', async () => {
    const { service, redis, applied } = makeHarness();
    await service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115');

    const meta = await redis.hgetall('telephony:conf:conf-CAagent1:meta');
    expect(meta).toMatchObject({
      type: 'outbound',
      primarySid: 'CAagent1',
      to: '+14045551234',
      from: '+12624061115',
      agentId: 'agent-1',
    });
    expect(applied[0]).toMatchObject({
      callSid: 'CAagent1',
      direction: 'outbound',
      from: '+12624061115',
      to: '+14045551234',
      status: 'initiated',
      agentId: 'agent-1',
      conferenceName: 'conf-CAagent1',
    });
  });

  it("the agent's participant-join creates the customer participant (early media + callbacks)", async () => {
    // NOT conference-start: a lone participant never starts a Twilio
    // conference, so start doesn't fire until the second participant exists.
    const { service, twilio, callsService } = makeHarness();
    await service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115');
    await service.onParticipantJoin('conf-CAagent1', 'CF999', 'CAagent1');

    expect(twilio.participantsCreate).toHaveBeenCalledTimes(1);
    const opts = twilio.participantsCreate.mock.calls[0][0];
    expect(opts).toMatchObject({
      to: '+14045551234',
      from: '+12624061115',
      earlyMedia: true,
      endConferenceOnExit: true,
      label: 'customer',
    });
    expect(opts.statusCallback).toContain(
      '/api/telephony/voice/status?conf=conf-CAagent1&role=customer',
    );
    expect(opts.statusCallbackEvent).toEqual([
      'initiated', 'ringing', 'answered', 'completed',
    ]);
    expect(callsService.appendChildSid).toHaveBeenCalledWith('CAagent1', 'CAcustomerLeg');
  });

  it('only the agent leg joining dials the customer — and only once', async () => {
    const { service, twilio } = makeHarness();
    await service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115');
    // the customer participant's own join must not re-dial
    await service.onParticipantJoin('conf-CAagent1', 'CF999', 'CAcustomerLeg');
    expect(twilio.participantsCreate).not.toHaveBeenCalled();

    await service.onParticipantJoin('conf-CAagent1', 'CF999', 'CAagent1');
    await service.onParticipantJoin('conf-CAagent1', 'CF999', 'CAagent1'); // dup event
    await service.onConferenceStart('conf-CAagent1', 'CF999'); // start is bookkeeping only
    expect(twilio.participantsCreate).toHaveBeenCalledTimes(1);
  });

  it('customer answered → answeredAt + in-progress on the primary record', async () => {
    const { service, applied } = makeHarness();
    await service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115');
    await service.onLegStatus('conf-CAagent1', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'in-progress',
    });

    const update = applied.at(-1);
    expect(update.callSid).toBe('CAagent1');
    expect(update.status).toBe('in-progress');
    expect(update.answeredAt).toBeDefined();
  });

  it('customer busy → conference completed via REST and record marked busy', async () => {
    const { service, twilio, applied } = makeHarness();
    await service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115');
    await service.onParticipantJoin('conf-CAagent1', 'CF999', 'CAagent1');
    await service.onLegStatus('conf-CAagent1', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'busy',
    });

    expect(twilio.conferenceUpdate).toHaveBeenCalledWith({ status: 'completed' });
    expect(applied.at(-1)).toMatchObject({ callSid: 'CAagent1', status: 'busy' });
  });

  it('conference-end finalizes: endedAt, terminal status, leftover legs completed, redis cleaned', async () => {
    const { service, redis, twilio, applied } = makeHarness();
    await service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115');
    await service.onParticipantJoin('conf-CAagent1', 'CF999', 'CAagent1');
    // agent hung up mid-ring: no answer recorded, customer leg still live
    await service.onConferenceEnd('conf-CAagent1');

    // leftover child leg REST-completed (belt and braces)
    expect(twilio.callUpdate).toHaveBeenCalledWith({ status: 'completed' });
    const final = applied.at(-1);
    expect(final).toMatchObject({ callSid: 'CAagent1', status: 'canceled' });
    expect(final.endedAt).toBeDefined();
    expect(await redis.hgetall('telephony:conf:conf-CAagent1:meta')).toEqual({});
  });

  it('conference-end after an answered call marks it completed', async () => {
    const { service, applied } = makeHarness();
    await service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115');
    await service.onParticipantJoin('conf-CAagent1', 'CF999', 'CAagent1');
    await service.onLegStatus('conf-CAagent1', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'in-progress',
    });
    await service.onConferenceEnd('conf-CAagent1');

    expect(applied.at(-1)).toMatchObject({ callSid: 'CAagent1', status: 'completed' });
  });
});

/**
 * The claim `prepare()` takes on a technician is what stops a second tap
 * placing a second real call. It has to come off the moment the call is over,
 * or a fast hang-up locks them out of their own phone until the TTL lapses —
 * which is exactly what somebody hitting redial experiences as "I can't call
 * anymore".
 */
describe('ConferenceService — freeing the technician after a bridged call', () => {
  const ended = {
    callSid: 'CAbridge',
    origin: 'bridge',
    agentId: 'tech-1',
    status: 'completed',
  };

  it('frees the technician when their bridged call ends', async () => {
    const { service, records, bridge } = makeHarness();
    records.set('CAbridge', ended);

    await service.releaseFinishedBridge('CAbridge');

    expect(bridge.release).toHaveBeenCalledWith('tech-1');
  });

  /** Mid-call is not over: releasing here would let a second call start while
   *  the first is still connected. */
  it('does not free them while the call is still live', async () => {
    const { service, records, bridge } = makeHarness();
    records.set('CAbridge', { ...ended, status: 'in-progress' });

    await service.releaseFinishedBridge('CAbridge');

    expect(bridge.release).not.toHaveBeenCalled();
  });

  it('ignores calls that were never bridges', async () => {
    const { service, records, bridge } = makeHarness();
    records.set('CAplain', { ...ended, callSid: 'CAplain', origin: undefined });

    await service.releaseFinishedBridge('CAplain');

    expect(bridge.release).not.toHaveBeenCalled();
  });

  it('says nothing about a call it has never heard of', async () => {
    const { service, bridge } = makeHarness();

    await service.releaseFinishedBridge('CAunknown');

    expect(bridge.release).not.toHaveBeenCalled();
  });

  /** The ordinary route: the conference ends, and the technician is free
   *  before they have finished putting the phone down. */
  it('frees them as part of the conference ending', async () => {
    const { service, records, bridge } = makeHarness();
    records.set('CAbridge', {
      callSid: 'CAbridge',
      origin: 'bridge',
      agentId: 'tech-1',
      status: 'in-progress',
      answeredAt: '2026-08-26T10:00:05.000Z',
    });

    await service.onConferenceEnd('conf-CAbridge');

    expect(bridge.release).toHaveBeenCalledWith('tech-1');
  });
});

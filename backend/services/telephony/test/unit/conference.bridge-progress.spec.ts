import { makeHarness } from './helpers/conference-harness';
import { BridgeService } from '../../src/common/bridge.service';

/**
 * The two legs of "Call client" report to ConferenceService, which moves the
 * bridge's progress along for the phone to poll: the technician's handset on
 * `/voice/status?bridge=<id>` (onBridgeLegStatus), the client's leg on
 * `?conf=<name>&role=customer` (onLegStatus), found through the bridge id the
 * answer webhook left in the conference meta.
 *
 * A real BridgeService over the harness's Redis, so what is asserted is what
 * the phone would read.
 */
function make() {
  const h = makeHarness();
  const bridge = new BridgeService(
    { client: h.redis } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (h.service as unknown as { bridge: BridgeService }).bridge = bridge;
  return { ...h, bridge };
}

const BRIDGE = 'b-1';
const OWNER = 'tech-1';
const status = (bridge: BridgeService) => bridge.statusFor(BRIDGE, OWNER);

/** The technician pressed a key: the conference is opened for this bridge. */
async function answeredAndPressed(service: ReturnType<typeof make>['service']) {
  await service.initOutbound('CAtech', OWNER, '+14045551234', '+12624061115', {
    origin: 'bridge',
    bridgeId: BRIDGE,
  });
  await service.onParticipantJoin('conf-CAtech', 'CF1', 'CAtech');
}

describe('ConferenceService — the technician’s handset moves the bridge along', () => {
  it('ringing keeps it at "ringing your phone"; in-progress is "you answered"', async () => {
    const { service, bridge } = make();
    await bridge.track(BRIDGE, OWNER);

    await service.onBridgeLegStatus(BRIDGE, { CallSid: 'CAtech', CallStatus: 'ringing' });
    expect(await status(bridge)).toEqual({ state: 'ringing_you' });

    await service.onBridgeLegStatus(BRIDGE, { CallSid: 'CAtech', CallStatus: 'in-progress' });
    expect(await status(bridge)).toEqual({ state: 'you_answered' });
  });

  /** The owner's test, 2026-10-14: a +380 handset the dev account may not call. */
  it('a geo-permission failure is told as the company line, and survives the release', async () => {
    const { service, bridge, redis } = make();
    await bridge.track(BRIDGE, OWNER);
    await redis.hset(`telephony:bridge:${BRIDGE}`, { technicianId: OWNER, to: '+1', from: '+1' });

    await service.onBridgeLegStatus(BRIDGE, {
      CallSid: 'CAtech',
      CallStatus: 'failed',
      ErrorCode: '21215',
    });

    expect(await status(bridge)).toEqual({
      state: 'failed',
      reason: 'Your number could not be reached from the company line',
    });
    // The claim and the context still go, as before.
    expect(await bridge.context(BRIDGE)).toBeNull();
  });

  it('no-answer says the phone did not answer', async () => {
    const { service, bridge } = make();
    await bridge.track(BRIDGE, OWNER);

    await service.onBridgeLegStatus(BRIDGE, { CallSid: 'CAtech', CallStatus: 'no-answer' });

    expect(await status(bridge)).toEqual({ state: 'failed', reason: 'Your phone did not answer' });
  });

  it('answered by voicemail, then over, says the voicemail answered and the client was never called', async () => {
    const { service, bridge } = make();
    await bridge.track(BRIDGE, OWNER);
    await service.onBridgeLegStatus(BRIDGE, { CallSid: 'CAtech', CallStatus: 'in-progress' });

    await service.onBridgeLegStatus(BRIDGE, {
      CallSid: 'CAtech',
      CallStatus: 'completed',
      AnsweredBy: 'machine_start',
    });

    expect(await status(bridge)).toEqual({
      state: 'failed',
      reason: 'Your voicemail answered, so the client was not called',
    });
  });

  it('answered by a person who hung up before the client was dialled is the end, not a failure', async () => {
    const { service, bridge } = make();
    await bridge.track(BRIDGE, OWNER);
    await service.onBridgeLegStatus(BRIDGE, { CallSid: 'CAtech', CallStatus: 'in-progress' });

    await service.onBridgeLegStatus(BRIDGE, { CallSid: 'CAtech', CallStatus: 'completed' });

    expect(await status(bridge)).toEqual({ state: 'ended' });
  });

  it('hanging up after a connected call is the end, not a failure', async () => {
    const { service, bridge } = make();
    await bridge.track(BRIDGE, OWNER);
    await answeredAndPressed(service);
    await service.onLegStatus('conf-CAtech', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'in-progress',
    });

    await service.onBridgeLegStatus(BRIDGE, { CallSid: 'CAtech', CallStatus: 'completed' });

    expect(await status(bridge)).toEqual({ state: 'ended' });
  });
});

describe('ConferenceService — the client’s leg moves the bridge along', () => {
  it('keeps the bridge id in the conference meta', async () => {
    const { service, redis } = make();

    await service.initOutbound('CAtech', OWNER, '+14045551234', '+12624061115', {
      origin: 'bridge',
      bridgeId: BRIDGE,
    });

    expect(await redis.hgetall('telephony:conf:conf-CAtech:meta')).toMatchObject({
      bridgeId: BRIDGE,
    });
  });

  it('the client answering is "connected"; their leg completing is "ended"', async () => {
    const { service, bridge } = make();
    await bridge.track(BRIDGE, OWNER);
    await answeredAndPressed(service);

    await service.onLegStatus('conf-CAtech', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'in-progress',
    });
    expect(await status(bridge)).toEqual({ state: 'connected' });

    await service.onLegStatus('conf-CAtech', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'completed',
    });
    expect(await status(bridge)).toEqual({ state: 'ended' });
  });

  it('the client not answering is recorded BEFORE the conference is torn down', async () => {
    const { service, bridge, twilio } = make();
    await bridge.track(BRIDGE, OWNER);
    await answeredAndPressed(service);
    // Tearing the conference down hangs up the technician, whose `completed`
    // must find the outcome already there rather than race it.
    let atTeardown: unknown;
    twilio.conferenceUpdate.mockImplementation(async () => {
      atTeardown = await status(bridge);
      return {};
    });

    await service.onLegStatus('conf-CAtech', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'no-answer',
    });

    expect(atTeardown).toEqual({ state: 'failed', reason: 'The client did not answer' });
    // …and the technician's leg ending afterwards does not overwrite it.
    await service.onBridgeLegStatus(BRIDGE, { CallSid: 'CAtech', CallStatus: 'completed' });
    expect(await status(bridge)).toEqual({ state: 'failed', reason: 'The client did not answer' });
  });

  it('a busy line and an unreachable number say so', async () => {
    const busy = make();
    await busy.bridge.track(BRIDGE, OWNER);
    await answeredAndPressed(busy.service);
    await busy.service.onLegStatus('conf-CAtech', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'busy',
    });
    expect(await status(busy.bridge)).toEqual({ state: 'failed', reason: "The client's line is busy" });

    const bad = make();
    await bad.bridge.track(BRIDGE, OWNER);
    await answeredAndPressed(bad.service);
    await bad.service.onLegStatus('conf-CAtech', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'failed',
      SipResponseCode: '404',
    });
    expect(await status(bad.bridge)).toEqual({
      state: 'failed',
      reason: "The client's number could not be reached",
    });
  });

  it('Twilio refusing to dial the client at all says the number could not be reached', async () => {
    const { service, bridge, twilio } = make();
    await bridge.track(BRIDGE, OWNER);
    twilio.participantsCreate.mockRejectedValueOnce(new Error("Invalid 'To' Phone Number"));

    await answeredAndPressed(service);

    expect(await status(bridge)).toEqual({
      state: 'failed',
      reason: "The client's number could not be reached",
    });
  });

  it('an ordinary (non-bridge) call touches no bridge', async () => {
    const { service, bridge } = make();
    const advance = jest.spyOn(bridge, 'advance');
    await service.initOutbound('CAagent', 'agent-1', '+14045551234', '+12624061115');
    await service.onParticipantJoin('conf-CAagent', 'CF2', 'CAagent');

    await service.onLegStatus('conf-CAagent', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'in-progress',
    });

    expect(advance).not.toHaveBeenCalled();
  });
});

describe('ConferenceService — progress is a courtesy, never a dependency', () => {
  it('a failed progress write still frees the technician and tears the conference down', async () => {
    const { service, bridge, redis, twilio } = make();
    await bridge.track(BRIDGE, OWNER);
    await redis.hset(`telephony:bridge:${BRIDGE}`, { technicianId: OWNER, to: '+1', from: '+1' });
    await answeredAndPressed(service);
    jest.spyOn(bridge, 'advance').mockRejectedValue(new Error('redis blip'));
    const release = jest.spyOn(bridge, 'release');

    await service.onLegStatus('conf-CAtech', 'customer', {
      CallSid: 'CAcustomerLeg',
      CallStatus: 'busy',
    });
    await service.onBridgeLegStatus(BRIDGE, { CallSid: 'CAtech', CallStatus: 'completed' });

    expect(twilio.conferenceUpdate).toHaveBeenCalledWith({ status: 'completed' });
    expect(release).toHaveBeenCalledWith(OWNER, BRIDGE);
  });
});

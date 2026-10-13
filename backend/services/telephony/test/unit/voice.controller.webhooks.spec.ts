import { VoiceController } from '../../src/voice/voice.controller';
import { WebhookQueue } from '../../src/common/webhook-queue';

/**
 * Twilio ignores the body of a status callback, so `/voice/conference-events`
 * and `/voice/status` answer `<Response/>` at once and do their work
 * afterwards, one event at a time per call — in arrival order.
 */

const flush = () => new Promise((r) => setImmediate(r));

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

function make(queue = new WebhookQueue()) {
  const conference = {
    onParticipantJoin: jest.fn().mockResolvedValue(undefined),
    onParticipantLeave: jest.fn().mockResolvedValue(undefined),
    onConferenceStart: jest.fn().mockResolvedValue(undefined),
    onConferenceEnd: jest.fn().mockResolvedValue(undefined),
    onBridgeLegStatus: jest.fn().mockResolvedValue(undefined),
    onLegStatus: jest.fn().mockResolvedValue(undefined),
    releaseFinishedBridge: jest.fn().mockResolvedValue(undefined),
  };
  const calls = { recordStatus: jest.fn().mockResolvedValue(undefined) };
  const controller = new VoiceController(
    {} as never,
    conference as never,
    calls as never,
    {} as never,
    {} as never,
    queue,
  );
  return { controller, conference, calls, queue };
}

describe('POST /voice/conference-events — reply first', () => {
  it('answers <Response/> before the handler has finished', async () => {
    const { controller, conference, queue } = make();
    const slow = gate();
    conference.onParticipantJoin.mockReturnValue(slow.promise);

    const xml = await controller.conferenceEvents({
      StatusCallbackEvent: 'participant-join',
      FriendlyName: 'conf-CAagent1',
      ConferenceSid: 'CF1',
      CallSid: 'CAagent1',
    });

    expect(xml).toBe('<Response/>');
    await flush();
    expect(conference.onParticipantJoin).toHaveBeenCalledWith('conf-CAagent1', 'CF1', 'CAagent1');
    expect(queue.size).toBe(1); // still running after the reply
    slow.open();
    await queue.idle();
  });

  it('events for one conference run strictly in arrival order', async () => {
    const { controller, conference, queue } = make();
    const order: string[] = [];
    const joinDone = gate();
    conference.onParticipantJoin.mockImplementation(async () => {
      await joinDone.promise;
      order.push('join');
    });
    conference.onConferenceEnd.mockImplementation(async () => {
      order.push('end');
    });

    await controller.conferenceEvents({
      StatusCallbackEvent: 'participant-join',
      FriendlyName: 'conf-CAagent1',
      ConferenceSid: 'CF1',
      CallSid: 'CAagent1',
    });
    await controller.conferenceEvents({
      StatusCallbackEvent: 'conference-end',
      FriendlyName: 'conf-CAagent1',
      ConferenceSid: 'CF1',
    });
    await flush();
    expect(order).toEqual([]); // end waits behind the join

    joinDone.open();
    await queue.idle();
    expect(order).toEqual(['join', 'end']);
  });

  it('dispatches each event type exactly as before', async () => {
    const { controller, conference, queue } = make();
    const base = { FriendlyName: 'conf-CA1', ConferenceSid: 'CF1' };
    await controller.conferenceEvents({ ...base, StatusCallbackEvent: 'participant-leave' });
    await controller.conferenceEvents({ ...base, StatusCallbackEvent: 'conference-start' });
    await controller.conferenceEvents({ ...base, StatusCallbackEvent: 'conference-end' });
    await controller.conferenceEvents({ ...base, StatusCallbackEvent: 'participant-mute' });
    await queue.idle();

    expect(conference.onParticipantLeave).toHaveBeenCalledWith('conf-CA1', 'CF1');
    expect(conference.onConferenceStart).toHaveBeenCalledWith('conf-CA1', 'CF1');
    expect(conference.onConferenceEnd).toHaveBeenCalledWith('conf-CA1');
    expect(conference.onParticipantJoin).not.toHaveBeenCalled();
  });

  it('a failing handler is logged, not thrown, and the reply is unaffected', async () => {
    const { controller, conference, queue } = make();
    const log = jest.spyOn((queue as any).logger, 'error').mockImplementation(() => undefined);
    conference.onConferenceEnd.mockRejectedValue(new Error('dynamo throttled'));

    await expect(
      controller.conferenceEvents({
        StatusCallbackEvent: 'conference-end',
        FriendlyName: 'conf-CA1',
        ConferenceSid: 'CF1',
      }),
    ).resolves.toBe('<Response/>');
    await queue.idle();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dynamo throttled'));
  });

  it('over the queue limit it falls back to working before replying', async () => {
    const { controller, conference } = make(new WebhookQueue(0));
    let finished = false;
    conference.onConferenceEnd.mockImplementation(async () => {
      await flush();
      finished = true;
    });
    await controller.conferenceEvents({
      StatusCallbackEvent: 'conference-end',
      FriendlyName: 'conf-CA1',
      ConferenceSid: 'CF1',
    });
    expect(finished).toBe(true);
  });
});

describe('POST /voice/status — reply first', () => {
  it('answers at once; the bare path records then releases the bridge, in order', async () => {
    const { controller, calls, conference, queue } = make();
    const order: string[] = [];
    const slow = gate();
    calls.recordStatus.mockImplementation(async () => {
      await slow.promise;
      order.push('record');
    });
    conference.releaseFinishedBridge.mockImplementation(async () => {
      order.push('release');
    });

    const xml = await controller.status({ CallSid: 'CA1', CallStatus: 'completed' });
    expect(xml).toBe('<Response/>');
    slow.open();
    await queue.idle();
    expect(order).toEqual(['record', 'release']);
    expect(conference.releaseFinishedBridge).toHaveBeenCalledWith('CA1');
  });

  it('routes conference legs and bridge legs as before', async () => {
    const { controller, conference, queue } = make();
    await controller.status({ CallSid: 'CAcust', CallStatus: 'busy' }, 'conf-CA1', 'customer');
    await controller.status({ CallSid: 'CAtech', CallStatus: 'ringing' }, undefined, undefined, 'b1');
    await queue.idle();
    expect(conference.onLegStatus).toHaveBeenCalledWith('conf-CA1', 'customer', {
      CallSid: 'CAcust',
      CallStatus: 'busy',
    });
    expect(conference.onBridgeLegStatus).toHaveBeenCalledWith('b1', {
      CallSid: 'CAtech',
      CallStatus: 'ringing',
    });
  });

  it("a leg's status queues behind its conference's events (same call key)", async () => {
    const { controller, conference, queue } = make();
    const order: string[] = [];
    const joinDone = gate();
    conference.onParticipantJoin.mockImplementation(async () => {
      await joinDone.promise;
      order.push('join');
    });
    conference.onLegStatus.mockImplementation(async () => {
      order.push('customer-busy');
    });

    await controller.conferenceEvents({
      StatusCallbackEvent: 'participant-join',
      FriendlyName: 'conf-CA1',
      ConferenceSid: 'CF1',
      CallSid: 'CA1',
    });
    await controller.status({ CallSid: 'CAcust', CallStatus: 'busy' }, 'conf-CA1', 'customer');
    await flush();
    expect(order).toEqual([]);
    joinDone.open();
    await queue.idle();
    expect(order).toEqual(['join', 'customer-busy']);
  });

  it('status callbacks for one CallSid keep their order', async () => {
    const { controller, calls, queue } = make();
    const seen: string[] = [];
    const first = gate();
    calls.recordStatus
      .mockImplementationOnce(async (b: { CallStatus: string }) => {
        await first.promise;
        seen.push(b.CallStatus);
      })
      .mockImplementationOnce(async (b: { CallStatus: string }) => {
        seen.push(b.CallStatus);
      });

    await controller.status({ CallSid: 'CA9', CallStatus: 'ringing' });
    await controller.status({ CallSid: 'CA9', CallStatus: 'completed' });
    first.open();
    await queue.idle();
    expect(seen).toEqual(['ringing', 'completed']);
  });
});

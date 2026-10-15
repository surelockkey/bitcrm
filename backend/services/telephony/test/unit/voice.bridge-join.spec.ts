import { VoiceService } from '../../src/voice/voice.service';
import { CONFIG } from './helpers/conference-harness';

/**
 * `/voice/bridge-join` answers the technician's handset on "call me about this
 * job". Since 2026-10-15 nobody presses a key: Twilio's answering-machine
 * detection runs before this webhook and posts `AnsweredBy`. A person (or
 * Twilio not being sure) hears "Connecting you to …" and the conference that
 * dials the client opens straight away — the moment the phone switches from
 * "Ringing your phone…" to "Connecting you to …". A voicemail box or a fax is
 * hung up on, and the client is never dialled.
 */
const CTX = {
  technicianId: 'tech-1',
  to: '+14045551234',
  from: '+14045550100',
  dealId: 'deal-1',
  contactId: 'contact-1',
  clientName: 'Maria Alvarez',
  dealNumber: 'K4T9ZW',
  actorId: 'tech-1',
};

function make(over: { claimed?: boolean } = {}) {
  const conference = {
    initOutbound: jest.fn().mockResolvedValue(undefined),
    sharedConferenceAttrs: jest.fn(() => ({})),
  };
  const bridge = {
    context: jest.fn().mockResolvedValue(CTX),
    claimAnswer: jest.fn().mockResolvedValue(over.claimed ?? true),
    advance: jest.fn().mockResolvedValue(null),
  };
  const service = new VoiceService(
    CONFIG,
    {} as never,
    conference as never,
    {} as never,
    undefined,
    bridge as never,
  );
  return { service, conference, bridge };
}

describe('VoiceService.buildBridgeJoin — telling the phone the client is being dialled', () => {
  it.each([['human'], ['unknown'], [undefined]])(
    'answered by %s: says who is being connected, no key to press, and dials the client',
    async (AnsweredBy) => {
      const { service, bridge, conference } = make();

      const xml = await service.buildBridgeJoin(
        'b-1',
        { CallSid: 'CAtech', ...(AnsweredBy && { AnsweredBy }) },
        true,
      );

      expect(xml).not.toContain('<Gather');
      expect(xml).not.toMatch(/press/i);
      expect(xml).toContain(
        '<Say>Connecting you to Maria Alvarez about job K4T9ZW. This call is recorded.</Say>',
      );
      expect(xml).toContain('<Conference');
      expect(bridge.claimAnswer).toHaveBeenCalledWith('b-1', 'CAtech');
      expect(bridge.advance).toHaveBeenCalledWith('b-1', expect.any(Function));
      const step = bridge.advance.mock.calls[0][1] as (s: string) => unknown;
      expect(step('you_answered')).toEqual({ state: 'connecting_client' });
      // The conference carries the bridge id, so the client's leg can report.
      expect(conference.initOutbound).toHaveBeenCalledWith(
        'CAtech',
        'tech-1',
        '+14045551234',
        '+14045550100',
        expect.objectContaining({ origin: 'bridge', bridgeId: 'b-1' }),
      );
    },
  );

  it('without a client name it still says what it is doing', async () => {
    const { service, bridge } = make();
    bridge.context.mockResolvedValue({ ...CTX, clientName: undefined, dealNumber: undefined });

    const xml = await service.buildBridgeJoin('b-1', { CallSid: 'CAtech', AnsweredBy: 'human' }, true);

    expect(xml).toContain('<Say>Connecting you to the client. This call is recorded.</Say>');
    expect(xml).toContain('<Conference');
  });

  it.each(['machine_start', 'machine_end_beep', 'machine_end_silence', 'machine_end_other', 'fax'])(
    'answered by %s: hangs up, never dials the client, and tells the phone the voicemail answered',
    async (AnsweredBy) => {
      const { service, bridge, conference } = make();

      const xml = await service.buildBridgeJoin('b-1', { CallSid: 'CAtech', AnsweredBy }, true);

      expect(xml).toContain('<Hangup/>');
      expect(xml).not.toContain('<Conference');
      expect(xml).not.toContain('<Gather');
      expect(conference.initOutbound).not.toHaveBeenCalled();
      expect(bridge.claimAnswer).not.toHaveBeenCalled();
      expect(bridge.advance).toHaveBeenCalledWith('b-1', expect.any(Function));
      const step = bridge.advance.mock.calls[0][1] as (s: string) => unknown;
      expect(step('you_answered')).toEqual({
        state: 'failed',
        reason: 'Your voicemail answered, so the client was not called',
      });
    },
  );

  it('a voicemail outcome that cannot be written still hangs up', async () => {
    const { service, bridge, conference } = make();
    bridge.advance.mockRejectedValue(new Error('redis down'));

    const xml = await service.buildBridgeJoin('b-1', { CallSid: 'CAtech', AnsweredBy: 'machine_start' }, true);

    expect(xml).toContain('<Hangup/>');
    expect(conference.initOutbound).not.toHaveBeenCalled();
  });

  it('a key press from a leg placed before the deploy still connects', async () => {
    // An in-flight leg can post its old <Gather> action after the deploy.
    const { service, conference } = make();

    const xml = await service.buildBridgeJoin('b-1', { CallSid: 'CAtech', Digits: '1' }, true);

    expect(xml).toContain('<Conference');
    expect(conference.initOutbound).toHaveBeenCalled();
  });

  it('a retried answer that lost the claim changes nothing', async () => {
    const { service, bridge, conference } = make({ claimed: false });

    const xml = await service.buildBridgeJoin('b-1', { CallSid: 'CAtech', AnsweredBy: 'human' }, true);

    expect(xml).not.toContain('<Conference');
    expect(bridge.advance).not.toHaveBeenCalled();
    expect(conference.initOutbound).not.toHaveBeenCalled();
  });

  it('a progress write that fails never costs the technician their call', async () => {
    const { service, bridge } = make();
    bridge.advance.mockRejectedValue(new Error('redis down'));

    const xml = await service.buildBridgeJoin('b-1', { CallSid: 'CAtech', AnsweredBy: 'human' }, true);

    expect(xml).toContain('<Conference');
  });
});

import { VoiceService } from '../../src/voice/voice.service';
import { CONFIG } from './helpers/conference-harness';

/**
 * `/voice/bridge-join` answers the technician's handset with a whisper —
 * "Press any key to connect" — and, once a key is pressed, opens the
 * conference that dials the client. That key press is the moment the phone
 * should switch from "Ringing your phone…" to "Connecting you to …".
 */
const CTX = {
  technicianId: 'tech-1',
  to: '+14045551234',
  from: '+14045550100',
  dealId: 'deal-1',
  contactId: 'contact-1',
  clientName: 'Maria Alvarez',
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
  it('says nothing while the whisper is still waiting for a key', async () => {
    const { service, bridge } = make();

    await service.buildBridgeJoin('b-1', { CallSid: 'CAtech' }, true);

    expect(bridge.advance).not.toHaveBeenCalled();
  });

  it('a key press moves the bridge to "connecting the client" and opens its conference', async () => {
    const { service, bridge, conference } = make();

    const xml = await service.buildBridgeJoin('b-1', { CallSid: 'CAtech', Digits: '1' }, true);

    expect(xml).toContain('<Conference');
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
  });

  it('a retried answer that lost the claim changes nothing', async () => {
    const { service, bridge } = make({ claimed: false });

    await service.buildBridgeJoin('b-1', { CallSid: 'CAtech', Digits: '1' }, true);

    expect(bridge.advance).not.toHaveBeenCalled();
  });

  it('a progress write that fails never costs the technician their call', async () => {
    const { service, bridge } = make();
    bridge.advance.mockRejectedValue(new Error('redis down'));

    const xml = await service.buildBridgeJoin('b-1', { CallSid: 'CAtech', Digits: '1' }, true);

    expect(xml).toContain('<Conference');
  });
});

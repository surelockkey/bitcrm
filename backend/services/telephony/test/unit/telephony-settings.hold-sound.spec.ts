import { BadRequestException } from '@nestjs/common';
import { PREMADE_HOLD_SOUNDS } from '@bitcrm/types';
import { TelephonySettingsService } from '../../src/telephony/telephony-settings.service';

/**
 * The hold music: what a caller hears while the agent has them on hold. One
 * company-wide choice on the settings row — a premade track or an uploaded
 * recording — and `null` (never chosen) plays the default track.
 */
function makeService(item?: Record<string, unknown>) {
  let stored: Record<string, unknown> | undefined = item;
  const client = {
    send: jest.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      if (cmd.constructor.name === 'GetCommand') return { Item: stored };
      const expr = String(cmd.input.UpdateExpression);
      const values = (cmd.input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
      stored = { ...(stored ?? {}) };
      if (expr.includes('REMOVE holdSound')) delete stored.holdSound;
      else if (expr.includes('holdSound')) stored.holdSound = values[':n'];
      stored.updatedAt = values[':now'];
      return {};
    }),
  };
  const numbers = { listOwned: jest.fn().mockResolvedValue([]) };
  const service = new TelephonySettingsService({ client } as never, numbers as never);
  return { service, read: () => stored };
}

const AUDIO_ID = '3f1c2a4e-9b7d-4c1e-8a2f-0d6e5b4c3a21';

describe('TelephonySettingsService — hold music', () => {
  it('is unchosen until somebody picks one', async () => {
    const { service } = makeService();
    await expect(service.get()).resolves.toMatchObject({ holdSound: null });
  });

  it('stores a premade track and reads it back', async () => {
    const { service, read } = makeService();
    const after = await service.setHoldSound({ kind: 'premade', id: 'ambient' });
    expect(after.holdSound).toEqual({ kind: 'premade', id: 'ambient' });
    expect(read()?.holdSound).toEqual({ kind: 'premade', id: 'ambient' });
    service.forget();
    await expect(service.get()).resolves.toMatchObject({
      holdSound: { kind: 'premade', id: 'ambient' },
    });
  });

  it('stores an uploaded recording by its audio id, with the name it was uploaded as', async () => {
    const { service, read } = makeService();
    await service.setHoldSound({ kind: 'custom', audioId: AUDIO_ID, name: '  our-jingle.mp3 ' });
    expect(read()?.holdSound).toEqual({ kind: 'custom', audioId: AUDIO_ID, name: 'our-jingle.mp3' });
  });

  it('keeps only the fields it knows', async () => {
    const { service, read } = makeService();
    await service.setHoldSound({ kind: 'premade', id: 'guitars', url: 'http://evil' } as never);
    expect(read()?.holdSound).toEqual({ kind: 'premade', id: 'guitars' });
  });

  it.each([
    ['an unknown premade track', { kind: 'premade', id: 'polka' }],
    ['a premade with no id', { kind: 'premade' }],
    ['a custom recording with no audio id', { kind: 'custom', name: 'x.mp3' }],
    ['a custom recording whose id is not one of ours', { kind: 'custom', audioId: '../../etc/passwd', name: 'x' }],
    ['a custom recording with an over-long name', { kind: 'custom', audioId: AUDIO_ID, name: 'x'.repeat(201) }],
    ['an unknown kind', { kind: 'radio', id: 'classical' }],
    ['a string', 'classical'],
  ])('refuses %s', async (_label, input) => {
    const { service } = makeService();
    await expect(service.setHoldSound(input as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('goes back to the default with null, leaving the other settings alone', async () => {
    const { service, read } = makeService({
      fallbackNumber: '+18888996849',
      holdSound: { kind: 'premade', id: 'ambient' },
    });
    const after = await service.setHoldSound(null);
    expect(after).toMatchObject({ fallbackNumber: '+18888996849', holdSound: null });
    expect(read()).toEqual({ fallbackNumber: '+18888996849', updatedAt: expect.any(String) });
  });

  it('reads a stored value it no longer recognises as unchosen', async () => {
    const { service } = makeService({ holdSound: { kind: 'premade', id: 'retired-track' } });
    await expect(service.get()).resolves.toMatchObject({ holdSound: null });
  });

  describe('holdMusicUrl — what Twilio plays', () => {
    const BASE = 'https://api.example.com/api/telephony/voice';

    it('plays the default track when nothing was chosen', async () => {
      const { service } = makeService();
      await expect(service.holdMusicUrl(BASE)).resolves.toBe(PREMADE_HOLD_SOUNDS[0].url);
    });

    it('plays the chosen premade track', async () => {
      const { service } = makeService({ holdSound: { kind: 'premade', id: 'guitars' } });
      await expect(service.holdMusicUrl(BASE)).resolves.toBe(
        PREMADE_HOLD_SOUNDS.find((s) => s.id === 'guitars')!.url,
      );
    });

    it('plays an uploaded recording through our own audio endpoint', async () => {
      const { service } = makeService({
        holdSound: { kind: 'custom', audioId: AUDIO_ID, name: 'jingle.mp3' },
      });
      await expect(service.holdMusicUrl(BASE)).resolves.toBe(`${BASE}/audio/${AUDIO_ID}`);
    });
  });
});

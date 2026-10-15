import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TwilioSignatureGuard } from '@bitcrm/shared';
import { PREMADE_HOLD_SOUNDS } from '@bitcrm/types';
import { VoiceController } from '../../src/voice/voice.controller';

/**
 * GET /voice/hold-music — the `holdUrl` a held customer's leg points at.
 * Twilio fetches it when the hold starts and plays what it says; `loop="0"`
 * keeps a three-minute track going for as long as the hold lasts.
 */
function make(holdMusicUrl: jest.Mock) {
  const settings = { holdMusicUrl };
  const config = { publicBaseUrl: 'https://api.example.com' };
  return new VoiceController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    settings as never,
    config as never,
  );
}

describe('GET /voice/hold-music', () => {
  it('loops the company’s hold music', async () => {
    const url = PREMADE_HOLD_SOUNDS[2].url;
    const holdMusicUrl = jest.fn().mockResolvedValue(url);

    const xml = await make(holdMusicUrl).holdMusic();

    expect(xml).toContain(`<Play loop="0">${url}</Play>`);
    // An upload is played through our own audio endpoint, built off the voice base.
    expect(holdMusicUrl).toHaveBeenCalledWith('https://api.example.com/api/telephony/voice');
  });

  it('escapes the URL into the TwiML', async () => {
    const xml = await make(jest.fn().mockResolvedValue('https://x.test/a.mp3?b=1&c=2')).holdMusic();
    expect(xml).toContain('https://x.test/a.mp3?b=1&amp;c=2');
  });

  it('still plays the default track when the settings cannot be read', async () => {
    const xml = await make(jest.fn().mockRejectedValue(new Error('dynamo down'))).holdMusic();
    expect(xml).toContain(`<Play loop="0">${PREMADE_HOLD_SOUNDS[0].url}</Play>`);
  });

  it('only answers Twilio — the signature guard covers it like every voice webhook', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, VoiceController) as unknown[];
    expect(guards).toContain(TwilioSignatureGuard);
  });
});

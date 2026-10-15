/**
 * What a caller hears while the agent has them on hold (the dialer's Hold
 * button). One company-wide choice, kept on telephony's settings row
 * (`TELEPHONY#SETTINGS`): one of the premade tracks below, or a recording
 * the office uploaded (the call flows' audio store, played back through
 * `GET /voice/audio/:id`). `null` — never chosen — plays the default track.
 */
export type HoldSound =
  | { kind: 'premade'; id: PremadeHoldSoundId }
  | { kind: 'custom'; audioId: string; name: string };

/**
 * The premade tracks: Twilio's public hold-music buckets
 * (`com.twilio.music.<genre>`, the same files Twilio's own hold-music twimlet
 * plays), addressed path-style over HTTPS — the virtual-host form
 * (`https://com.twilio.music.classical.s3.amazonaws.com/…`) fails TLS because
 * the bucket name has dots in it, and the settings page previews them from an
 * HTTPS origin, where an `http://` track would be blocked as mixed content.
 */
export const PREMADE_HOLD_SOUNDS = [
  {
    id: 'classical',
    name: 'Classical — strings',
    url: 'https://s3.amazonaws.com/com.twilio.music.classical/BusyStrings.mp3',
  },
  {
    id: 'piano',
    name: 'Classical — piano',
    url: 'https://s3.amazonaws.com/com.twilio.music.classical/ith_chopin-15-2.mp3',
  },
  {
    id: 'ambient',
    name: 'Ambient',
    url: 'https://s3.amazonaws.com/com.twilio.music.ambient/aerosolspray_-_Living_Taciturn.mp3',
  },
  {
    id: 'soft-rock',
    name: 'Soft rock',
    url: 'https://s3.amazonaws.com/com.twilio.music.soft-rock/jacksontorreal_-_The_First_Sunny_Sky.mp3',
  },
  {
    id: 'electronica',
    name: 'Electronica',
    url: 'https://s3.amazonaws.com/com.twilio.music.electronica/teru_-_110_Downtempo_Electronic_4.mp3',
  },
  {
    id: 'guitars',
    name: 'Guitars',
    url: 'https://s3.amazonaws.com/com.twilio.music.guitars/Pitx_-_A_Thought.mp3',
  },
] as const;

export type PremadeHoldSoundId = (typeof PREMADE_HOLD_SOUNDS)[number]['id'];

/** What plays when nobody has chosen. */
export const DEFAULT_HOLD_SOUND_ID: PremadeHoldSoundId = 'classical';

/** The premade track with this id, or undefined for an id we do not have. */
export function premadeHoldSound(
  id: string,
): (typeof PREMADE_HOLD_SOUNDS)[number] | undefined {
  return PREMADE_HOLD_SOUNDS.find((s) => s.id === id);
}

/** Bounds shared by the API's validation and the settings page. */
export const HOLD_SOUND_LIMITS = {
  nameMaxLength: 200,
} as const;

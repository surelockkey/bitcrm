/**
 * A phone that is not a person: Workiz's Devices — the shop lines and desk
 * phones a call group or a Forward step rings beside the softphones
 * (`/root/callsReport/devices`; the account has 18, "SURE CT LOCKSMITH
 * ((203) 989-3585)" in a group's "Users and devices").
 *
 * A device is a number (or a SIP address) with a name. Nothing in the CRM
 * answers it, so a call it takes has no agent, and a voicemail box behind it
 * can win the ring — the same caveats as a Forward to an external number.
 */
export type CallDeviceType = 'desk_phone' | 'shop_line' | 'mobile' | 'other';

export interface CallDevice {
  id: string;
  name: string;
  /** E.164. One of `number` / `sipAddress` is set. */
  number?: string;
  /** `user@sip.example.com` — rung as `sip:…`. */
  sipAddress?: string;
  type: CallDeviceType;
  /** A paused device keeps its place in groups but is skipped by routing. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
  /** `workiz:device:<id>` on an imported one. */
  externalId?: string;
}

export const CALL_DEVICE_TYPES: readonly CallDeviceType[] = [
  'desk_phone',
  'shop_line',
  'mobile',
  'other',
];

export const CALL_DEVICE_LIMITS = {
  nameMaxLength: 60,
  /** One partition holds the catalog; a workspace has tens of devices. */
  maxDevices: 200,
} as const;

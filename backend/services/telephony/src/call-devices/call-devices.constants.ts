/**
 * The Devices catalog (Workiz's desk phones and shop lines) lives in the calls
 * table as one more config collection with no GSI keys, beside the call tags
 * and the per-number settings — the shape the Workiz import proposed for it
 * (workiz-data-parser `docs/import/bitcrm_format/telephony.md` §4.3):
 *
 *   PK = 'DEVICE', SK = 'DEVICE#<id>'
 *
 * One partition holds every device, so listing is a single Query; a workspace
 * has tens of devices, never thousands.
 */
export const CALL_DEVICE_PK = 'DEVICE';
export const callDeviceSk = (id: string) => `DEVICE#${id}`;

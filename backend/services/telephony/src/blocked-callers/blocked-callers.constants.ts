/**
 * Blocked callers (Workiz Phone → "Blocked callers") live in the calls table
 * as one small item collection, the way per-number settings (`NUMSET#ALL`)
 * and the call-tag catalog (`CALLTAG#ALL`) do:
 *
 *   PK = 'BLOCKED#ALL', SK = '<E.164>'
 *
 * One partition holds every blocked number, so the inbound check is a GetItem
 * (or one cached Query) and the list is a single Query — no index, no scan,
 * and nothing written to the three call GSIs (a blocked number must never
 * surface in the call log). Safe because a workspace blocks hundreds of
 * numbers (Workiz: 930), not millions.
 *
 * This is also the shape the Workiz import writes (workiz-data-parser,
 * `entities/telephony.py::blocked()`, `docs/import/bitcrm_format/telephony.md`
 * §4.4): `id` = uuid5 of the Workiz id, `externalId` =
 * `workiz:blocked_caller:<id>`, `createdBy` = `workiz-import`.
 */
export const BLOCKED_CALLERS_PK = 'BLOCKED#ALL';
export const blockedCallerSk = (e164: string) => e164;

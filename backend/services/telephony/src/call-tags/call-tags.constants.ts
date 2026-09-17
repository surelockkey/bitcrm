/**
 * Call-tag catalog rows live in the calls table as one small item collection,
 * the way per-number settings (`NUMSET#ALL`) already do:
 *
 *   PK = 'CALLTAG#ALL', SK = 'CALLTAG#<id>'
 *
 * One partition holds every tag, so listing is a single Query and reading one
 * is a GetItem — no index, no scan, and nothing written to the three call
 * GSIs (a catalog row must never surface in the call log). Safe because a
 * workspace has tens of call tags (Workiz: 28), not thousands.
 *
 * Import convention: a Workiz call tag (type 3) becomes one item whose `id`
 * is `bid('tag', <workizId>)` and whose `externalId` is `workiz:tag:<id>` —
 * see docs/CALL_TAGS_IMPORT.md.
 */
export const CALL_TAG_PK = 'CALLTAG#ALL';
export const CALL_TAG_SK_PREFIX = 'CALLTAG#';
export const callTagSk = (id: string) => `${CALL_TAG_SK_PREFIX}${id}`;

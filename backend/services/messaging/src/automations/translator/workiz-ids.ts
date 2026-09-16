import { createHash } from 'node:crypto';

/**
 * Workiz ids → BitCRM ids, exactly as the importer computes them
 * (`workiz-data-parser/workiz/bitcrm/ids.py`):
 *
 *   id         = uuid5(BITCRM_NS, "<namespace>:<workiz id>")
 *   externalId = "workiz:<namespace>:<workiz id>"
 *   BITCRM_NS  = uuid5(NAMESPACE_URL, "https://bitcrm.tech-slk.com/workiz")
 *
 * The translator needs this because an imported rule compares against
 * Workiz's own numeric ids (`sub_status_id: "14217"`, `tags: "718269"`,
 * `adgroup_id: "1192834"`) while a job in BitCRM carries the uuid the
 * importer minted for the same row. Deriving it is what lets an imported
 * rule run against imported data without a lookup table. The namespace
 * strings are fixed forever (IMPORT_PLAN §1.2) — changing one would change
 * every id in the database.
 */
export const BITCRM_NAMESPACE = '489d081e-d230-585d-9119-ad61d13edc16';

const HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidToBytes(uuid: string): Buffer {
  if (!HEX.test(uuid)) throw new Error(`Not a uuid: ${uuid}`);
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/** RFC 4122 v5 (SHA-1). Node has no built-in; this is the whole algorithm. */
export function uuidV5(name: string, namespace: string = BITCRM_NAMESPACE): string {
  const hash = createHash('sha1').update(uuidToBytes(namespace)).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The importer's namespaces the rules refer to. */
export type WorkizNamespace = 'substatus' | 'tag' | 'adgroup' | 'jobtype' | 'metro' | 'user' | 'role' | 'call_flow';

/** `uuid5("<namespace>:<workiz id>")` — the id the imported row carries in BitCRM. */
export const bitcrmId = (namespace: WorkizNamespace, workizId: string | number): string =>
  uuidV5(`${namespace}:${String(workizId).trim()}`);

export const externalId = (namespace: WorkizNamespace, workizId: string | number): string =>
  `workiz:${namespace}:${String(workizId).trim()}`;

import type { AdminAuditChange } from '@bitcrm/types';

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Leaves of an object as dotted paths; arrays and scalars are leaves. */
function flatten(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, `${prefix}.${k}`, out);
    return;
  }
  if (value !== undefined) out.set(prefix, value);
}

/**
 * What an audit line says changed: each field (dotted into objects, so one
 * flipped permission is one change) whose value moved, `from` → `to`; a side
 * that was not set is left out. `undefined` when nothing moved. With `keys`,
 * only those top-level fields are looked at.
 */
export function diffFields(
  beforeValue: object,
  afterValue: object,
  keys?: readonly string[],
): Record<string, AdminAuditChange> | undefined {
  const before = beforeValue as Plain;
  const after = afterValue as Plain;
  const fields = keys ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  for (const key of fields) {
    flatten(before[key], key, a);
    flatten(after[key], key, b);
  }
  const changes: Record<string, AdminAuditChange> = {};
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const from = a.get(path);
    const to = b.get(path);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[path] = { ...(from !== undefined && { from }), ...(to !== undefined && { to }) };
  }
  return Object.keys(changes).length ? changes : undefined;
}

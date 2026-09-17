/**
 * Builds a DynamoDB `SET … REMOVE …` expression. `undefined` values in `set`
 * are skipped; `null` values are turned into REMOVEs (clearing an optional
 * attribute), as are the names in `remove`.
 */
export function buildUpdate(
  set: Record<string, unknown>,
  remove: string[] = [],
  opts: { incrementVersion?: boolean } = {},
): {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
} {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  const removes = new Set(remove);

  let i = 0;
  for (const [key, value] of Object.entries(set)) {
    if (value === undefined) continue;
    if (value === null) {
      removes.add(key);
      continue;
    }
    removes.delete(key);
    names[`#s${i}`] = key;
    values[`:s${i}`] = value;
    sets.push(`#s${i} = :s${i}`);
    i++;
  }
  if (opts.incrementVersion) {
    names['#version'] = 'version';
    values[':one'] = 1;
    values[':zero'] = 0;
    sets.push('#version = if_not_exists(#version, :zero) + :one');
  }

  const rem: string[] = [];
  let j = 0;
  for (const key of removes) {
    if (key in set && set[key] !== null && set[key] !== undefined) continue;
    names[`#r${j}`] = key;
    rem.push(`#r${j}`);
    j++;
  }

  const parts: string[] = [];
  if (sets.length) parts.push(`SET ${sets.join(', ')}`);
  if (rem.length) parts.push(`REMOVE ${rem.join(', ')}`);
  return {
    UpdateExpression: parts.join(' '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

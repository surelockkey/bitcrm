/**
 * Just enough of the deals table for the Items report and the Done-lines
 * backfill: Query on the base table and on any GSI (`#pk = :pk` plus
 * `#sk BETWEEN` / `begins_with(#sk, …)`, `#status = :active` and the undated
 * read's `#createdAt BETWEEN` filter), Scan (filters ignored — the callers
 * classify rows in code), Get / Put, and the GSI7 SET / REMOVE updates with
 * their conditions. Every call is recorded.
 */
type Item = Record<string, any>;

export function fakeDealsTable(seed: Item[]) {
  const rows = new Map<string, Item>(seed.map((it) => [`${it.PK}|${it.SK}`, { ...it }]));
  const calls: Array<{ name: string; input: any }> = [];
  const conditionFailed = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });

  const send = jest.fn(async (cmd: { constructor: { name: string }; input: any }) => {
    const name = cmd.constructor.name;
    const input = cmd.input;
    calls.push({ name, input });
    const v = input.ExpressionAttributeValues ?? {};
    const n = input.ExpressionAttributeNames ?? {};

    if (name === 'GetCommand') {
      const it = rows.get(`${input.Key.PK}|${input.Key.SK}`);
      return { Item: it ? { ...it } : undefined };
    }
    if (name === 'PutCommand') {
      rows.set(`${input.Item.PK}|${input.Item.SK}`, { ...input.Item });
      return {};
    }
    if (name === 'ScanCommand') return { Items: [...rows.values()].map((it) => ({ ...it })) };
    if (name === 'UpdateCommand') {
      const key = `${input.Key.PK}|${input.Key.SK}`;
      const it = rows.get(key);
      const cond: string = input.ConditionExpression ?? '';
      if (cond.includes('attribute_exists(PK)') && !it) throw conditionFailed();
      if (cond.includes('attribute_not_exists(GSI7SK)') && it?.GSI7SK !== undefined) throw conditionFailed();
      if (cond.includes('GSI7SK = :was') && it?.GSI7SK !== v[':was']) throw conditionFailed();
      if (!it) return {};
      if (input.UpdateExpression === 'SET GSI7PK = :pk, GSI7SK = :sk') Object.assign(it, { GSI7PK: v[':pk'], GSI7SK: v[':sk'] });
      else if (input.UpdateExpression === 'REMOVE GSI7PK, GSI7SK') {
        delete it.GSI7PK;
        delete it.GSI7SK;
      } else throw new Error(`unexpected update ${input.UpdateExpression}`);
      return {};
    }
    if (name !== 'QueryCommand') throw new Error(`unexpected ${name}`);

    const kc: string = input.KeyConditionExpression;
    const pkAttr = n['#pk'] ?? 'PK';
    const skAttr = n['#sk'] ?? 'SK';
    let found = [...rows.values()].filter((it) => it[pkAttr] === v[':pk']);
    const between = /(?:#sk|SK) BETWEEN (:\w+) AND (:\w+)/.exec(kc);
    if (between) found = found.filter((it) => it[skAttr] >= v[between[1]] && it[skAttr] <= v[between[2]]);
    const begins = /begins_with\((?:#sk|SK), (:\w+)\)/.exec(kc);
    if (begins) found = found.filter((it) => typeof it[skAttr] === 'string' && it[skAttr].startsWith(v[begins[1]]));
    const filter: string = input.FilterExpression ?? '';
    if (filter.includes('#status = :active')) found = found.filter((it) => it.status === v[':active']);
    if (filter.includes(':createdFrom')) found = found.filter((it) => it.createdAt >= v[':createdFrom'] && it.createdAt <= v[':createdTo']);
    found.sort((a, b) => (a[skAttr] < b[skAttr] ? -1 : a[skAttr] > b[skAttr] ? 1 : 0));
    return { Items: found.map((it) => ({ ...it })) };
  });

  return { dynamoDb: { client: { send } }, send, calls, rows };
}

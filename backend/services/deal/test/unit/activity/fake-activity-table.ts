/**
 * Just enough DynamoDB for the Activity indexes: Query on ActivityDayIndex
 * (GSI8PK =) and ActorIndex (GSI9PK = … AND GSI9SK BETWEEN), in either order,
 * with Limit applied BEFORE the filter (as DynamoDB does), ExclusiveStartKey,
 * `contains(#search, :q) [OR #dealId = :qDeal]` and Select COUNT; BatchGet and
 * Get by key. Every call is recorded.
 */
type Item = Record<string, any>;

export function fakeActivityTable(items: Item[]) {
  const calls: Array<{ name: string; input: any }> = [];
  const byKey = new Map(items.map((it) => [`${it.PK}|${it.SK}`, it]));

  const send = jest.fn(async (cmd: { constructor: { name: string }; input: any }) => {
    const name = cmd.constructor.name;
    const input = cmd.input;
    calls.push({ name, input });
    if (name === 'GetCommand') return { Item: byKey.get(`${input.Key.PK}|${input.Key.SK}`) };
    if (name === 'BatchGetCommand') {
      const [table, req] = Object.entries(input.RequestItems)[0] as [string, { Keys: Item[] }];
      return { Responses: { [table]: req.Keys.map((k) => byKey.get(`${k.PK}|${k.SK}`)).filter(Boolean) } };
    }
    if (name !== 'QueryCommand') throw new Error(`unexpected ${name}`);

    const v = input.ExpressionAttributeValues;
    const day = input.IndexName === 'ActivityDayIndex';
    const pkAttr = day ? 'GSI8PK' : 'GSI9PK';
    const skAttr = day ? 'GSI8SK' : 'GSI9SK';
    let rows = items.filter((it) => it[pkAttr] === v[':pk']);
    if (v[':lo'] !== undefined) rows = rows.filter((it) => it[skAttr] >= v[':lo'] && it[skAttr] <= v[':hi']);
    rows.sort((a, b) => String(a[skAttr]).localeCompare(String(b[skAttr])));
    if (input.ScanIndexForward === false) rows.reverse();
    if (input.ExclusiveStartKey) {
      const at = rows.findIndex((it) => it[skAttr] === input.ExclusiveStartKey[skAttr]);
      rows = rows.slice(at + 1);
    }
    const evaluated = input.Limit ? rows.slice(0, input.Limit) : rows;
    const more = evaluated.length < rows.length;
    const last = evaluated[evaluated.length - 1];
    const matches = (it: Item) => {
      if (!input.FilterExpression) return true;
      const hit = String(it.activitySearch ?? '').includes(v[':q']);
      return hit || (v[':qDeal'] !== undefined && it.dealId === v[':qDeal']);
    };
    const found = evaluated.filter(matches);
    const LastEvaluatedKey = more && last ? { PK: last.PK, SK: last.SK, [pkAttr]: last[pkAttr], [skAttr]: last[skAttr] } : undefined;
    if (input.Select === 'COUNT') return { Count: found.length, LastEvaluatedKey };
    return { Items: found, LastEvaluatedKey };
  });

  return { dynamoDb: { client: { send } }, send, calls };
}

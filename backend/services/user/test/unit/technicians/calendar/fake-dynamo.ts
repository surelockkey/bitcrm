/**
 * A small in-memory stand-in for the users table, enough for the calendar
 * repository and the month-index backfill: Get, Put, Delete, Query on the
 * table's PK/SK (BETWEEN, `<=`, begins_with, `#id = :id` filter), Scan, and
 * TransactWrite with the handful of condition shapes those writers use.
 *
 * `pageSize` cuts every Query/Scan page short so a reader that does not follow
 * `LastEvaluatedKey` is caught.
 */
type Item = Record<string, any>;

const keyOf = (pk: string, sk: string) => `${pk}\u0000${sk}`;

export class FakeDynamo {
  readonly items = new Map<string, Item>();
  readonly sent: { name: string; input: any }[] = [];
  pageSize = Number.POSITIVE_INFINITY;

  put(item: Item): void {
    this.items.set(keyOf(item.PK, item.SK), JSON.parse(JSON.stringify(item)));
  }

  rows(prefix?: string): Item[] {
    return [...this.items.values()]
      .filter((i) => !prefix || String(i.PK).startsWith(prefix))
      .sort((a, b) => (a.PK === b.PK ? (a.SK < b.SK ? -1 : 1) : a.PK < b.PK ? -1 : 1));
  }

  client = {
    send: jest.fn(async (cmd: any) => this.handle(cmd.constructor.name, cmd.input)),
  };

  private async handle(name: string, input: any): Promise<any> {
    this.sent.push({ name, input });
    switch (name) {
      case 'GetCommand': {
        const item = this.items.get(keyOf(input.Key.PK, input.Key.SK));
        return { Item: item ? { ...item } : undefined };
      }
      case 'PutCommand': {
        this.assertCondition(input.Item, input);
        this.put(stripUndefined(input.Item));
        return {};
      }
      case 'DeleteCommand': {
        this.assertCondition(input.Key, input);
        this.items.delete(keyOf(input.Key.PK, input.Key.SK));
        return {};
      }
      case 'QueryCommand':
        return this.query(input);
      case 'ScanCommand':
        return this.page(this.rows(), input.ExclusiveStartKey);
      case 'TransactWriteCommand':
        return this.transact(input);
      default:
        throw new Error(`FakeDynamo: unexpected ${name}`);
    }
  }

  private query(input: any): any {
    const v = input.ExpressionAttributeValues ?? {};
    const kce: string = input.KeyConditionExpression;
    let rows = this.rows().filter((i) => i.PK === v[':pk']);
    if (/SK BETWEEN :lo AND :hi/.test(kce)) rows = rows.filter((i) => i.SK >= v[':lo'] && i.SK <= v[':hi']);
    else if (/SK <= :hi/.test(kce)) rows = rows.filter((i) => i.SK <= v[':hi']);
    else if (/begins_with\(SK, :sk\)/.test(kce)) rows = rows.filter((i) => String(i.SK).startsWith(v[':sk']));
    else if (kce.trim() !== 'PK = :pk') throw new Error(`FakeDynamo: key condition ${kce}`);

    const out = this.page(rows, input.ExclusiveStartKey);
    if (input.FilterExpression === '#id = :id') out.Items = out.Items.filter((i: Item) => i.id === v[':id']);
    else if (input.FilterExpression) throw new Error(`FakeDynamo: filter ${input.FilterExpression}`);
    return out;
  }

  private page(rows: Item[], startKey?: { PK: string; SK: string }): any {
    let from = 0;
    if (startKey) {
      from = rows.findIndex((r) => r.PK === startKey.PK && r.SK === startKey.SK) + 1;
    }
    const slice = rows.slice(from, from + this.pageSize);
    const more = from + this.pageSize < rows.length;
    const last = slice[slice.length - 1];
    return {
      Items: slice.map((i) => ({ ...i })),
      ...(more && last ? { LastEvaluatedKey: { PK: last.PK, SK: last.SK } } : {}),
    };
  }

  private transact(input: any): any {
    const ops: any[] = input.TransactItems;
    if (ops.length > 100) throw new Error('FakeDynamo: more than 100 transact items');
    const seen = new Set<string>();
    const reasons = ops.map((op) => {
      const [kind, body] = Object.entries(op)[0] as [string, any];
      const key = kind === 'Put' ? body.Item : body.Key;
      const k = keyOf(key.PK, key.SK);
      if (seen.has(k)) throw new Error(`FakeDynamo: two operations on ${key.PK} / ${key.SK}`);
      seen.add(k);
      return this.conditionHolds(key, body) ? { Code: 'None' } : { Code: 'ConditionalCheckFailed' };
    });
    if (reasons.some((r) => r.Code !== 'None')) {
      throw Object.assign(new Error('Transaction cancelled'), {
        name: 'TransactionCanceledException',
        CancellationReasons: reasons,
      });
    }
    for (const op of ops) {
      if (op.Put) this.put(stripUndefined(op.Put.Item));
      else if (op.Delete) this.items.delete(keyOf(op.Delete.Key.PK, op.Delete.Key.SK));
      else if (!op.ConditionCheck) throw new Error(`FakeDynamo: transact op ${Object.keys(op)[0]}`);
    }
    return {};
  }

  private assertCondition(key: Item, input: any): void {
    if (!this.conditionHolds(key, input)) {
      throw Object.assign(new Error('The conditional request failed'), {
        name: 'ConditionalCheckFailedException',
      });
    }
  }

  /** The condition shapes the calendar writers use, joined by AND / OR. */
  private conditionHolds(key: Item, input: any): boolean {
    const expr: string | undefined = input.ConditionExpression;
    if (!expr) return true;
    const current = this.items.get(keyOf(key.PK, key.SK));
    const names = input.ExpressionAttributeNames ?? {};
    const values = input.ExpressionAttributeValues ?? {};
    const attr = (n: string) => names[n] ?? n;
    const term = (t: string): boolean => {
      t = t.trim();
      let m = /^attribute_not_exists\((.+)\)$/.exec(t);
      if (m) return !current || current[attr(m[1])] === undefined;
      m = /^attribute_exists\((.+)\)$/.exec(t);
      if (m) return !!current && current[attr(m[1])] !== undefined;
      m = /^(\S+) = (:\S+)$/.exec(t);
      if (m) return !!current && current[attr(m[1])] === values[m[2]];
      throw new Error(`FakeDynamo: condition ${t}`);
    };
    return expr.split(' OR ').some((alt) => alt.split(' AND ').every(term));
  }
}

function stripUndefined(item: Item): Item {
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
}

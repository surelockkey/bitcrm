/**
 * The deals table's report indexes, in memory — for checking the Jobs report
 * end to end without DynamoDB (`verify-jobs-report.ts --service`).
 *
 * Holds deal rows under the three indexes `DealsRepository.readReportWindow`
 * reads (StageIndex GSI1, StatusScheduleIndex GSI5, EndIndex GSI7), with the
 * keys computed by the repository's own functions — GSI7 exactly as
 * `backfill:end-index` would stamp an imported row — and answers the
 * `QueryCommand`s that method sends: a `BETWEEN` or `begins_with` on the sort
 * key, the `#status = :active` filter (plus the undated window's
 * `#createdAt BETWEEN`), the projection, and 1 MB-ish pages via
 * `ExclusiveStartKey`. Anything else throws: it is a check, not a database.
 */
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { JobSuperStatus, STAGE_TO_SUPER_STATUS, type DealStage } from '@bitcrm/types';
import { endIndexKeys, statusScheduleKeys } from '../deals/deals.repository';
import type { ReportDateSource } from '../deals/report/report-dates';

type Item = Record<string, unknown>;

const INDEXES: Record<string, { pk: string; sk: string }> = {
  StageIndex: { pk: 'GSI1PK', sk: 'GSI1SK' },
  StatusScheduleIndex: { pk: 'GSI5PK', sk: 'GSI5SK' },
  EndIndex: { pk: 'GSI7PK', sk: 'GSI7SK' },
};
const PAGE = 400;

export class InMemoryReportIndexes {
  private readonly partitions = new Map<string, Item[]>();
  queries = 0;

  constructor(items: Item[]) {
    for (const raw of items) {
      const id = String(raw.id);
      const superStatus =
        (raw.superStatus as JobSuperStatus | undefined) ?? STAGE_TO_SUPER_STATUS[raw.stage as DealStage] ?? JobSuperStatus.SUBMITTED;
      const item: Item = {
        ...raw,
        GSI1PK: raw.GSI1PK ?? `STATUS#${superStatus}`,
        GSI1SK: raw.GSI1SK ?? `${raw.createdAt}#DEAL#${id}`,
        ...statusScheduleKeys({
          id,
          superStatus,
          scheduledDate: raw.scheduledDate as string | undefined,
          scheduledTimeSlot: raw.scheduledTimeSlot as string | undefined,
          allDay: raw.allDay as boolean | undefined,
        }),
        ...endIndexKeys({ ...(raw as ReportDateSource), id }),
      };
      for (const [name, keys] of Object.entries(INDEXES)) {
        const pk = item[keys.pk];
        if (typeof pk !== 'string' || typeof item[keys.sk] !== 'string') continue;
        const k = `${name}|${pk}`;
        const list = this.partitions.get(k) ?? [];
        list.push(item);
        this.partitions.set(k, list);
      }
    }
    for (const [k, list] of this.partitions) {
      const sk = INDEXES[k.split('|')[0]].sk;
      list.sort((a, b) => (String(a[sk]) < String(b[sk]) ? -1 : String(a[sk]) > String(b[sk]) ? 1 : 0));
    }
  }

  /** The `DynamoDbService` a `DealsRepository` is built with. */
  get dynamoDb(): { client: { send: (cmd: unknown) => Promise<unknown> } } {
    return { client: { send: async (cmd: unknown) => this.query(cmd) } };
  }

  private query(cmd: unknown): { Items: Item[]; LastEvaluatedKey?: Item } {
    if (!(cmd instanceof QueryCommand)) throw new Error('in-memory indexes answer QueryCommand only');
    this.queries += 1;
    const input = cmd.input;
    const index = INDEXES[input.IndexName ?? ''];
    if (!index) throw new Error(`unknown index ${input.IndexName}`);
    const names = input.ExpressionAttributeNames ?? {};
    const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
    const attr = (alias: string) => names[alias] ?? alias;

    const key = input.KeyConditionExpression ?? '';
    const between = /^#pk = :pk AND #sk BETWEEN (:\w+) AND (:\w+)$/.exec(key);
    const begins = /^#pk = :pk AND begins_with\(#sk, (:\w+)\)$/.exec(key);
    if (!between && !begins) throw new Error(`key condition not understood: ${key}`);
    const sk = index.sk;
    const matchKey = (item: Item): boolean => {
      const v = String(item[sk]);
      if (between) return v >= String(values[between[1]]) && v <= String(values[between[2]]);
      return v.startsWith(String(values[begins![1]]));
    };

    const filter = input.FilterExpression ?? '';
    const parts = filter.split(' AND ');
    const clauses: ((item: Item) => boolean)[] = [];
    for (let i = 0; i < parts.length; i++) {
      const eq = /^(#\w+) = (:\w+)$/.exec(parts[i]);
      const range = /^(#\w+) BETWEEN (:\w+)$/.exec(parts[i]);
      if (eq) {
        clauses.push((item) => item[attr(eq[1])] === values[eq[2]]);
      } else if (range && parts[i + 1]) {
        const hi = parts[++i];
        clauses.push((item) => {
          const v = item[attr(range[1])] as string | undefined;
          return v !== undefined && v >= String(values[range[2]]) && v <= String(values[hi]);
        });
      } else if (parts[i]) {
        throw new Error(`filter not understood: ${filter}`);
      }
    }

    const list = this.partitions.get(`${input.IndexName}|${values[':pk']}`) ?? [];
    let start = 0;
    if (input.ExclusiveStartKey) {
      const after = input.ExclusiveStartKey as Item;
      start = list.findIndex((i) => i.PK === after.PK && i.SK === after.SK) + 1;
    }
    const inKey = list.slice(start).filter(matchKey);
    const page = inKey.slice(0, PAGE);
    const projection = (input.ProjectionExpression ?? '').split(', ').filter(Boolean).map(attr);
    const project = (item: Item): Item =>
      projection.length ? Object.fromEntries(projection.filter((a) => item[a] !== undefined).map((a) => [a, item[a]])) : item;
    const last = inKey.length > PAGE ? page[page.length - 1] : undefined;
    return {
      Items: page.filter((item) => clauses.every((c) => c(item))).map(project),
      ...(last && { LastEvaluatedKey: { PK: last.PK, SK: last.SK, [index.pk]: last[index.pk], [sk]: last[sk] } }),
    };
  }
}

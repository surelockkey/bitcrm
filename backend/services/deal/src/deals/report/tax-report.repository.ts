import { Injectable } from '@nestjs/common';
import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { DEALS_TABLE } from '../../common/constants/dynamo.constants';
import { DealsRepository } from '../deals.repository';
import { TAX_REPORT_PROJECTION, type TaxDealRow } from './tax-report.rules';

const BATCH = 100;
const MAX_RETRIES = 5;

/**
 * The Tax report's reads of the deal table.
 *
 * - Accrual windows the jobs on the date "By:" names — created, job date or
 *   job end date — through the Jobs report's `readReportWindow` (one index
 *   per date: StageIndex, StatusScheduleIndex, EndIndex), projected to the
 *   tax fields only.
 * - Paid names its jobs by id (the ones that collected money in the window):
 *   BatchGet, projected, unprocessed keys retried.
 */
@Injectable()
export class TaxReportRepository {
  constructor(
    private readonly deals: DealsRepository,
    private readonly db: DynamoDbService,
  ) {}

  window(by: 'created' | 'scheduled' | 'end', from: string, to: string): Promise<Record<string, unknown>[]> {
    return this.deals.readReportWindow(by, from, to, TAX_REPORT_PROJECTION);
  }

  async byIds(ids: string[]): Promise<TaxDealRow[]> {
    const names: Record<string, string> = { '#st': 'status' };
    const projection = [...TAX_REPORT_PROJECTION, 'status']
      .map((attr, i) => {
        if (attr === 'status') return '#st';
        names[`#p${i}`] = attr;
        return `#p${i}`;
      })
      .join(', ');
    const out: TaxDealRow[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      let keys: Record<string, unknown>[] = ids.slice(i, i + BATCH).map((id) => ({ PK: `DEAL#${id}`, SK: 'METADATA' }));
      for (let attempt = 0; keys.length && attempt <= MAX_RETRIES; attempt++) {
        const res = await this.db.client.send(
          new BatchGetCommand({
            RequestItems: { [DEALS_TABLE]: { Keys: keys, ProjectionExpression: projection, ExpressionAttributeNames: names } },
          }),
        );
        for (const item of res.Responses?.[DEALS_TABLE] ?? []) {
          if (item.status === 'deleted') continue;
          out.push(item as unknown as TaxDealRow);
        }
        keys = (res.UnprocessedKeys?.[DEALS_TABLE]?.Keys as Record<string, unknown>[] | undefined) ?? [];
        if (keys.length) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
    return out;
  }
}

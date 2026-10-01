import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  SALES_REPORT_BY,
  SALES_REPORT_COLUMN_IDS,
  SALES_REPORT_DEFAULT_SETTINGS,
  type SalesReportBy,
  type SalesReportColumnId,
  type SalesReportSettings,
} from '@bitcrm/types';
import { DEALS_TABLE } from '../../common/constants/dynamo.constants';

const PK = 'CONFIG#SALES_REPORT';
const SK = 'METADATA';

/**
 * One config row in the deals table: the Sales report's visible columns and
 * the "By:" it opens on — per account, as Workiz keeps `salesReportSettings`.
 * The Jobs report keeps its own the same way (`CONFIG#JOBS_REPORT`).
 *
 *   PK = CONFIG#SALES_REPORT, SK = METADATA  { columns[], by, updatedAt, updatedBy }
 *
 * No index: one GetItem. A column the code no longer knows is dropped on
 * read, so a stale row can never name a column the page cannot draw.
 */
@Injectable()
export class SalesReportSettingsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async get(): Promise<SalesReportSettings> {
    const result = await this.dynamoDb.client.send(new GetCommand({ TableName: DEALS_TABLE, Key: { PK, SK } }));
    const item = result.Item;
    if (!item) return { ...SALES_REPORT_DEFAULT_SETTINGS, columns: [...SALES_REPORT_DEFAULT_SETTINGS.columns] };
    const stored = Array.isArray(item.columns) ? (item.columns as string[]) : [];
    const columns = SALES_REPORT_COLUMN_IDS.filter((c) => stored.includes(c));
    const by = (SALES_REPORT_BY as readonly string[]).includes(item.by as string) ? (item.by as SalesReportBy) : SALES_REPORT_DEFAULT_SETTINGS.by;
    return { columns: columns.length ? columns : [...SALES_REPORT_DEFAULT_SETTINGS.columns], by };
  }

  async put(settings: { columns: SalesReportColumnId[]; by: SalesReportBy }, updatedBy: string): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: { PK, SK, columns: settings.columns, by: settings.by, updatedAt: new Date().toISOString(), updatedBy },
      }),
    );
  }
}

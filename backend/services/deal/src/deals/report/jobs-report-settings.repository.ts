import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  JOBS_REPORT_BY,
  JOBS_REPORT_COLUMN_IDS,
  JOBS_REPORT_DEFAULT_SETTINGS,
  type JobsReportBy,
  type JobsReportColumnId,
  type JobsReportSettings,
} from '@bitcrm/types';
import { DEALS_TABLE } from '../../common/constants/dynamo.constants';

const PK = 'CONFIG#JOBS_REPORT';
const SK = 'METADATA';

/**
 * One config row in the deals table: the Jobs report's visible columns and
 * the "By:" it opens on — per account, as Workiz keeps `jobReportSettings`.
 *
 *   PK = CONFIG#JOBS_REPORT, SK = METADATA  { columns[], by, updatedAt, updatedBy }
 *
 * No index: one GetItem. A column the code no longer knows is dropped on
 * read, so a stale row can never name a column the page cannot draw.
 */
@Injectable()
export class JobsReportSettingsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async get(): Promise<JobsReportSettings> {
    const result = await this.dynamoDb.client.send(new GetCommand({ TableName: DEALS_TABLE, Key: { PK, SK } }));
    const item = result.Item;
    if (!item) return { ...JOBS_REPORT_DEFAULT_SETTINGS, columns: [...JOBS_REPORT_DEFAULT_SETTINGS.columns] };
    const stored = Array.isArray(item.columns) ? (item.columns as string[]) : [];
    const columns = JOBS_REPORT_COLUMN_IDS.filter((c) => stored.includes(c));
    const by = (JOBS_REPORT_BY as readonly string[]).includes(item.by as string) ? (item.by as JobsReportBy) : JOBS_REPORT_DEFAULT_SETTINGS.by;
    return { columns: columns.length ? columns : [...JOBS_REPORT_DEFAULT_SETTINGS.columns], by };
  }

  async put(settings: { columns: JobsReportColumnId[]; by: JobsReportBy }, updatedBy: string): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: { PK, SK, columns: settings.columns, by: settings.by, updatedAt: new Date().toISOString(), updatedBy },
      }),
    );
  }
}

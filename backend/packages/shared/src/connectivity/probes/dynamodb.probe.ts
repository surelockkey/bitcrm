import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  Probe,
  ProbeKind,
  ProbeOutcome,
  ProbeResourceStatus,
} from '../connectivity.types';

export class DynamoDbProbe implements Probe {
  readonly name = 'dynamodb';
  readonly kind: ProbeKind = 'dynamodb';

  constructor(
    private readonly client: DynamoDBClient,
    private readonly requiredTables: string[] = [],
  ) {}

  async run(): Promise<ProbeOutcome> {
    // Describe each required table individually rather than ListTables: the
    // latter needs account-wide dynamodb:ListTables on resource "*", which
    // breaks per-service least-privilege. DescribeTable is scoped to the exact
    // table ARN the service already has access to (mirrors S3/SQS probes).
    const resources: ProbeResourceStatus[] = await Promise.all(
      this.requiredTables.map(async (table) => {
        try {
          const res = await this.client.send(
            new DescribeTableCommand({ TableName: table }),
          );
          const status = res.Table?.TableStatus;
          return status === 'ACTIVE' || status === 'UPDATING'
            ? { resource: table, present: true }
            : {
                resource: table,
                present: false,
                details: status ?? 'unknown status',
              };
        } catch (err) {
          const detail =
            (err as { name?: string; message?: string })?.name ??
            (err as Error)?.message;
          return { resource: table, present: false, details: detail };
        }
      }),
    );
    const present = resources.filter((r) => r.present).length;
    return {
      ok: resources.length === 0 ? true : present === resources.length,
      message:
        resources.length === 0
          ? 'no required tables configured'
          : `${present}/${resources.length} tables accessible`,
      resources,
    };
  }
}

import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
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
    const all: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListTablesCommand({ ExclusiveStartTableName: token }),
      );
      if (res.TableNames) all.push(...res.TableNames);
      token = res.LastEvaluatedTableName;
    } while (token);

    const resources: ProbeResourceStatus[] = this.requiredTables.map((t) => ({
      resource: t,
      present: all.includes(t),
    }));
    const present = resources.filter((r) => r.present).length;
    const ok = resources.length === 0 ? true : present === resources.length;

    return {
      ok,
      message:
        resources.length === 0
          ? `${all.length} tables`
          : `${all.length} tables, ${present}/${resources.length} required present`,
      resources,
    };
  }
}

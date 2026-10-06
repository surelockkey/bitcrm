import { Injectable } from '@nestjs/common';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { PaymentSchedule } from '@bitcrm/types';
import { BILLING_TABLE, METADATA_SK, stripKeys } from '../common/constants/dynamo.constants';

/**
 * `PAYMENT_SCHEDULE#<dealId>` / METADATA — a job's schedule, one row. Its own
 * partition rather than a row under the invoice's: a job has a schedule before
 * it has an invoice, and nothing that reads an invoice's partition should ever
 * meet it.
 */
export const paymentSchedulePk = (dealId: string) => `PAYMENT_SCHEDULE#${dealId}`;

@Injectable()
export class PaymentScheduleRepository {
  constructor(private readonly db: DynamoDbService) {}

  async get(dealId: string): Promise<PaymentSchedule | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: paymentSchedulePk(dealId), SK: METADATA_SK } }),
    );
    return stripKeys<PaymentSchedule>(res.Item) ?? null;
  }

  async put(schedule: PaymentSchedule): Promise<PaymentSchedule> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: { PK: paymentSchedulePk(schedule.dealId), SK: METADATA_SK, entityType: 'payment_schedule', ...schedule },
      }),
    );
    return schedule;
  }

  async delete(dealId: string): Promise<void> {
    await this.db.client.send(
      new DeleteCommand({ TableName: BILLING_TABLE, Key: { PK: paymentSchedulePk(dealId), SK: METADATA_SK } }),
    );
  }
}

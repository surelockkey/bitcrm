import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { CreateTopicCommand, SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import { CreateQueueCommand, GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';

/**
 * LocalStack: the `billing-events` topic and the `billing-deal-events` queue
 * (+ DLQ) subscribed to `deal-events`. Put the printed ARN/URL into
 * BILLING_EVENTS_TOPIC_ARN / BILLING_DEAL_EVENTS_QUEUE_URL to use them.
 */
const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ENDPOINT && {
    endpoint: process.env.AWS_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
};

async function main() {
  const sns = new SNSClient(awsConfig);
  const sqs = new SQSClient(awsConfig);

  const billingTopic = await sns.send(new CreateTopicCommand({ Name: 'bitcrm-billing-events' }));
  console.log(`SNS topic "bitcrm-billing-events" ready: ${billingTopic.TopicArn}`);
  const dealTopic = await sns.send(new CreateTopicCommand({ Name: 'bitcrm-deal-events' }));

  const dlq = await sqs.send(
    new CreateQueueCommand({
      QueueName: 'billing-deal-events-dlq',
      Attributes: { MessageRetentionPeriod: '1209600' },
    }),
  );
  const dlqArn = (
    await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl, AttributeNames: ['QueueArn'] }))
  ).Attributes?.QueueArn;

  const queue = await sqs.send(
    new CreateQueueCommand({
      QueueName: 'billing-deal-events',
      Attributes: {
        VisibilityTimeout: '60',
        MessageRetentionPeriod: '345600',
        ...(dlqArn && {
          RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 5 }),
        }),
      },
    }),
  );
  console.log(`SQS queue "billing-deal-events" ready: ${queue.QueueUrl}`);

  const queueArn = (
    await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queue.QueueUrl, AttributeNames: ['QueueArn'] }))
  ).Attributes?.QueueArn;
  if (dealTopic.TopicArn && queueArn) {
    await sns.send(
      new SubscribeCommand({ TopicArn: dealTopic.TopicArn, Protocol: 'sqs', Endpoint: queueArn }),
    );
    console.log('Subscribed billing-deal-events to bitcrm-deal-events');
  }
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

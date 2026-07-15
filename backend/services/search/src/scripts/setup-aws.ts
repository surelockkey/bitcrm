/**
 * Local (LocalStack) provisioning for search-service: the search-index-queue
 * (+ DLQ) and its SNS→SQS subscriptions to every domain topic. In prod these are
 * provisioned by Terraform (infra/modules/sns-sqs); this mirrors them for local
 * dev so the indexer hears every service's events.
 *
 *   npm run setup:aws
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import {
  SNSClient,
  CreateTopicCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ENDPOINT && {
    endpoint: process.env.AWS_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
};

const TOPICS = [
  'bitcrm-user-events',
  'bitcrm-deal-events',
  'bitcrm-crm-events',
  'bitcrm-inventory-events',
];

const QUEUE_NAME = 'search-index-queue';
const DLQ_NAME = 'search-index-queue-dlq';

async function main() {
  console.log('Setting up search-service AWS resources...\n');
  const sns = new SNSClient(awsConfig);
  const sqs = new SQSClient(awsConfig);

  // Topics (idempotent) → collect ARNs.
  const topicArns: string[] = [];
  for (const Name of TOPICS) {
    const res = await sns.send(new CreateTopicCommand({ Name }));
    console.log(`SNS topic "${Name}" ready: ${res.TopicArn}`);
    if (res.TopicArn) topicArns.push(res.TopicArn);
  }

  // DLQ.
  const dlq = await sqs.send(
    new CreateQueueCommand({
      QueueName: DLQ_NAME,
      Attributes: { MessageRetentionPeriod: '1209600' },
    }),
  );
  const dlqArn = (
    await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: dlq.QueueUrl,
        AttributeNames: ['QueueArn'],
      }),
    )
  ).Attributes?.QueueArn;
  console.log(`SQS DLQ "${DLQ_NAME}" ready: ${dlq.QueueUrl}`);

  // Main queue with redrive.
  const queue = await sqs.send(
    new CreateQueueCommand({
      QueueName: QUEUE_NAME,
      Attributes: {
        VisibilityTimeout: '30',
        MessageRetentionPeriod: '345600',
        ...(dlqArn && {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: dlqArn,
            maxReceiveCount: 5,
          }),
        }),
      },
    }),
  );
  const queueArn = (
    await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queue.QueueUrl,
        AttributeNames: ['QueueArn'],
      }),
    )
  ).Attributes?.QueueArn;
  console.log(`SQS queue "${QUEUE_NAME}" ready: ${queue.QueueUrl}`);

  // Allow the topics to deliver to the queue.
  await sqs.send(
    new SetQueueAttributesCommand({
      QueueUrl: queue.QueueUrl,
      Attributes: {
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'sns.amazonaws.com' },
              Action: 'sqs:SendMessage',
              Resource: queueArn,
            },
          ],
        }),
      },
    }),
  );

  // Subscribe the queue to every topic.
  for (const TopicArn of topicArns) {
    await sns.send(
      new SubscribeCommand({
        TopicArn,
        Protocol: 'sqs',
        Endpoint: queueArn,
      }),
    );
    console.log(`Subscribed ${QUEUE_NAME} → ${TopicArn}`);
  }

  console.log('\nDone!');
  console.log(`Set SEARCH_INDEX_QUEUE_URL=${queue.QueueUrl}`);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

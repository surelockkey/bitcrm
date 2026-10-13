import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { CreateTopicCommand, SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import { CreateQueueCommand, GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';

/**
 * LocalStack: the `deal-events-to-telephony` queue (+ DLQ) subscribed to
 * `deal-events` (CallDealEventsHandler restamps `dealTotal` on linked calls)
 * and crm's `contact-events` (locally `bitcrm-crm-events`; CallContactEventsHandler clears the caller-name
 * cache). Put the printed URL into DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL and set
 * ENABLE_SQS_CONSUMER=true to consume it. (In AWS the queue is Terraform's —
 * infra/dev `sns_sqs` — and its URL reaches the task from SSM
 * /bitcrm/dev/sqs/deal-events-to-telephony/url.)
 */
const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ENDPOINT && {
    endpoint: process.env.AWS_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
};

const QUEUE = 'deal-events-to-telephony';

async function main() {
  const sns = new SNSClient(awsConfig);
  const sqs = new SQSClient(awsConfig);

  const dealTopic = await sns.send(new CreateTopicCommand({ Name: 'bitcrm-deal-events' }));
  const contactTopic = await sns.send(new CreateTopicCommand({ Name: 'bitcrm-crm-events' }));

  const dlq = await sqs.send(
    new CreateQueueCommand({
      QueueName: `${QUEUE}-dlq`,
      Attributes: { MessageRetentionPeriod: '1209600' },
    }),
  );
  const dlqArn = (
    await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl, AttributeNames: ['QueueArn'] }))
  ).Attributes?.QueueArn;

  const queue = await sqs.send(
    new CreateQueueCommand({
      QueueName: QUEUE,
      Attributes: {
        VisibilityTimeout: '30',
        MessageRetentionPeriod: '345600',
        ...(dlqArn && {
          RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 5 }),
        }),
      },
    }),
  );
  console.log(`SQS queue "${QUEUE}" ready: ${queue.QueueUrl}`);

  const queueArn = (
    await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queue.QueueUrl, AttributeNames: ['QueueArn'] }))
  ).Attributes?.QueueArn;
  for (const [name, topic] of [
    ['bitcrm-deal-events', dealTopic.TopicArn],
    ['bitcrm-crm-events', contactTopic.TopicArn],
  ] as const) {
    if (!topic || !queueArn) continue;
    await sns.send(new SubscribeCommand({ TopicArn: topic, Protocol: 'sqs', Endpoint: queueArn }));
    console.log(`Subscribed ${QUEUE} to ${name}`);
  }
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

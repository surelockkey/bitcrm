import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { SNSClient, CreateTopicCommand } from '@aws-sdk/client-sns';
import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ENDPOINT && {
    endpoint: process.env.AWS_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
};

const SNS_TOPICS = ['bitcrm-deal-events'];

const SQS_QUEUES = [
  { name: 'deal-service-events', dlqName: 'deal-service-events-dlq' },
];

async function setupSNS(sns: SNSClient): Promise<void> {
  for (const Name of SNS_TOPICS) {
    try {
      const result = await sns.send(new CreateTopicCommand({ Name }));
      console.log(`SNS topic "${Name}" ready: ${result.TopicArn}`);
    } catch (err) {
      console.error(`Failed to create SNS topic "${Name}":`, err);
    }
  }
}

async function setupSQS(sqs: SQSClient): Promise<void> {
  for (const { name, dlqName } of SQS_QUEUES) {
    try {
      const dlq = await sqs.send(
        new CreateQueueCommand({
          QueueName: dlqName,
          Attributes: { MessageRetentionPeriod: '1209600' },
        }),
      );
      console.log(`SQS DLQ "${dlqName}" ready: ${dlq.QueueUrl}`);

      const dlqAttrs = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: dlq.QueueUrl,
          AttributeNames: ['QueueArn'],
        }),
      );
      const dlqArn = dlqAttrs.Attributes?.QueueArn;

      const main = await sqs.send(
        new CreateQueueCommand({
          QueueName: name,
          Attributes: {
            VisibilityTimeout: '30',
            MessageRetentionPeriod: '345600',
            ...(dlqArn && {
              RedrivePolicy: JSON.stringify({
                deadLetterTargetArn: dlqArn,
                maxReceiveCount: 3,
              }),
            }),
          },
        }),
      );
      console.log(`SQS queue "${name}" ready: ${main.QueueUrl}`);
    } catch (err) {
      console.error(`Failed to create SQS queue "${name}":`, err);
    }
  }
}

async function main() {
  console.log('Setting up deal-service AWS resources...\n');
  await setupSNS(new SNSClient(awsConfig));
  console.log('');
  await setupSQS(new SQSClient(awsConfig));
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

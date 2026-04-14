import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import {
  SNSClient,
  CreateTopicCommand,
} from '@aws-sdk/client-sns';
import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ENDPOINT && {
    endpoint: process.env.AWS_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    forcePathStyle: true,
  }),
};

const SNS_TOPICS = ['bitcrm-user-events', 'bitcrm-inventory-events'];

const SQS_QUEUES = [
  { name: 'inventory-user-events', dlqName: 'inventory-user-events-dlq' },
];

const S3_BUCKET = process.env.S3_BUCKET || 'bitcrm-uploads';

async function setupSNS() {
  const sns = new SNSClient(awsConfig);

  for (const topicName of SNS_TOPICS) {
    try {
      const result = await sns.send(
        new CreateTopicCommand({ Name: topicName }),
      );
      console.log(`SNS topic "${topicName}" created: ${result.TopicArn}`);
    } catch (error) {
      console.error(`Failed to create SNS topic "${topicName}":`, error);
    }
  }
}

async function setupSQS() {
  const sqs = new SQSClient(awsConfig);

  for (const { name, dlqName } of SQS_QUEUES) {
    try {
      // Create DLQ first
      const dlqResult = await sqs.send(
        new CreateQueueCommand({
          QueueName: dlqName,
          Attributes: {
            MessageRetentionPeriod: '1209600', // 14 days
          },
        }),
      );
      console.log(`SQS DLQ "${dlqName}" created: ${dlqResult.QueueUrl}`);

      // Get DLQ ARN
      const dlqAttrs = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: dlqResult.QueueUrl,
          AttributeNames: ['QueueArn'],
        }),
      );
      const dlqArn = dlqAttrs.Attributes?.QueueArn;

      // Create main queue with DLQ redrive policy
      const result = await sqs.send(
        new CreateQueueCommand({
          QueueName: name,
          Attributes: {
            VisibilityTimeout: '30',
            MessageRetentionPeriod: '345600', // 4 days
            ...(dlqArn && {
              RedrivePolicy: JSON.stringify({
                deadLetterTargetArn: dlqArn,
                maxReceiveCount: 3,
              }),
            }),
          },
        }),
      );
      console.log(`SQS queue "${name}" created: ${result.QueueUrl}`);
    } catch (error) {
      console.error(`Failed to create SQS queue "${name}":`, error);
    }
  }
}

async function setupS3() {
  const s3 = new S3Client(awsConfig);

  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    console.log(`S3 bucket "${S3_BUCKET}" already exists`);
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
      console.log(`S3 bucket "${S3_BUCKET}" created`);
    } catch (error) {
      console.error(`Failed to create S3 bucket "${S3_BUCKET}":`, error);
    }
  }
}

async function main() {
  console.log('Setting up AWS resources...\n');
  await setupSNS();
  console.log('');
  await setupSQS();
  console.log('');
  await setupS3();
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

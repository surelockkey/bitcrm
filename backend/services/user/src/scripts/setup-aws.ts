import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { SNSClient, CreateTopicCommand } from '@aws-sdk/client-sns';

const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ENDPOINT && {
    endpoint: process.env.AWS_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
};

const SNS_TOPICS = ['bitcrm-user-events'];

async function main() {
  const sns = new SNSClient(awsConfig);
  console.log('Setting up user-service AWS resources...\n');

  for (const Name of SNS_TOPICS) {
    try {
      const result = await sns.send(new CreateTopicCommand({ Name }));
      console.log(`SNS topic "${Name}" ready: ${result.TopicArn}`);
    } catch (err) {
      console.error(`Failed to create SNS topic "${Name}":`, err);
    }
  }

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

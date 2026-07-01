import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { SNSClient, CreateTopicCommand } from '@aws-sdk/client-sns';
import {
  KMSClient,
  CreateKeyCommand,
  CreateAliasCommand,
  ListAliasesCommand,
} from '@aws-sdk/client-kms';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';

const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ENDPOINT && {
    endpoint: process.env.AWS_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
};

const SNS_TOPICS = ['bitcrm-user-events'];
const DOCUMENTS_KMS_ALIAS = process.env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents';
const DOCUMENTS_BUCKET =
  process.env.DOCUMENTS_BUCKET || process.env.S3_BUCKET || 'bitcrm-uploads';

async function setupSns() {
  const sns = new SNSClient(awsConfig);
  for (const Name of SNS_TOPICS) {
    try {
      const result = await sns.send(new CreateTopicCommand({ Name }));
      console.log(`SNS topic "${Name}" ready: ${result.TopicArn}`);
    } catch (err) {
      console.error(`Failed to create SNS topic "${Name}":`, err);
    }
  }
}

/**
 * Provision the documents KMS key + alias for local dev. In production this key
 * is created by Terraform (infra/modules/kms-key); this only runs against
 * LocalStack (when AWS_ENDPOINT is set) so we don't create real prod keys here.
 */
async function setupKms() {
  if (!process.env.AWS_ENDPOINT) {
    console.log('KMS: skipped (no AWS_ENDPOINT — managed by Terraform in real AWS)');
    return;
  }
  const kms = new KMSClient(awsConfig);
  const aliasName = DOCUMENTS_KMS_ALIAS.startsWith('alias/')
    ? DOCUMENTS_KMS_ALIAS
    : `alias/${DOCUMENTS_KMS_ALIAS}`;
  try {
    const aliases = await kms.send(new ListAliasesCommand({}));
    if (aliases.Aliases?.some((a) => a.AliasName === aliasName)) {
      console.log(`KMS alias "${aliasName}" already exists`);
      return;
    }
    const key = await kms.send(
      new CreateKeyCommand({ Description: 'BitCRM technician documents/fields' }),
    );
    await kms.send(
      new CreateAliasCommand({ AliasName: aliasName, TargetKeyId: key.KeyMetadata!.KeyId }),
    );
    console.log(`KMS key created + aliased as "${aliasName}"`);
  } catch (err) {
    console.error('Failed to set up KMS key:', err);
  }
}

async function setupBucket() {
  const s3 = new S3Client({ ...awsConfig, forcePathStyle: !!process.env.AWS_ENDPOINT });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: DOCUMENTS_BUCKET }));
    console.log(`S3 bucket "${DOCUMENTS_BUCKET}" already exists`);
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: DOCUMENTS_BUCKET }));
      console.log(`S3 bucket "${DOCUMENTS_BUCKET}" created`);
    } catch (err) {
      console.error(`Failed to ensure bucket "${DOCUMENTS_BUCKET}":`, err);
    }
  }
}

async function main() {
  console.log('Setting up user-service AWS resources...\n');
  await setupSns();
  await setupKms();
  await setupBucket();
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});

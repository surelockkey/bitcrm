import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import {
  OPENSEARCH_ENDPOINT,
  OPENSEARCH_SERVERLESS,
  AWS_REGION,
} from '../constants/opensearch.constants';

/**
 * Thin wrapper around the OpenSearch client — mirrors the role DynamoDbService
 * plays for DynamoDB. In prod (Serverless / a signed domain) it signs requests
 * with SigV4 via the task role; locally it talks to the plaintext container.
 */
@Injectable()
export class OpenSearchService implements OnModuleDestroy {
  private readonly logger = new Logger(OpenSearchService.name);
  readonly client: Client;

  constructor() {
    const node = OPENSEARCH_ENDPOINT;

    if (OPENSEARCH_SERVERLESS || /\.amazonaws\.com/.test(node)) {
      this.client = new Client({
        ...AwsSigv4Signer({
          region: AWS_REGION,
          service: OPENSEARCH_SERVERLESS ? 'aoss' : 'es',
          getCredentials: () => defaultProvider()(),
        }),
        node,
      });
      this.logger.log(`OpenSearch client (SigV4, ${node})`);
    } else {
      this.client = new Client({ node });
      this.logger.log(`OpenSearch client (plaintext, ${node})`);
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (err) {
      this.logger.warn(`OpenSearch ping failed: ${(err as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close().catch(() => undefined);
  }
}

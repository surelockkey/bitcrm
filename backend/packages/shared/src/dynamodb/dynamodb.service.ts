import * as http from 'http';
import * as https from 'https';
import { Injectable } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { NodeHttpHandler } from '@smithy/node-http-handler';

/**
 * Sockets per client. The SDK's default handler allows 50, and a service has
 * ONE DynamoDB client — under a fan-out (a report, a batch of name lookups)
 * request 51 waits in the agent's queue, which shows up as latency nowhere
 * near DynamoDB.
 */
const DEFAULT_MAX_SOCKETS = 200;
/** TCP + TLS handshake budget for a new socket. */
const CONNECTION_TIMEOUT_MS = 3_000;
/**
 * Socket inactivity budget for one request. The SDK retries a timed-out
 * request, so a stalled socket costs one retry instead of hanging the caller.
 */
const REQUEST_TIMEOUT_MS = 10_000;

function maxSockets(): number {
  const parsed = Number(process.env.DYNAMODB_MAX_SOCKETS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SOCKETS;
}

@Injectable()
export class DynamoDbService {
  public readonly client: DynamoDBDocumentClient;

  constructor() {
    const sockets = maxSockets();
    const ddbClient = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
      // Both agents: AWS is https, DynamoDB Local (DYNAMODB_ENDPOINT) is http.
      requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({ keepAlive: true, maxSockets: sockets }),
        httpAgent: new http.Agent({ keepAlive: true, maxSockets: sockets }),
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        requestTimeout: REQUEST_TIMEOUT_MS,
      }),
    });
    this.client = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: {
        removeUndefinedValues: true,
        // The services run a ValidationPipe with `transform: true`, so request
        // DTOs arrive as class instances (e.g. AddressDto). When one is written
        // to DynamoDB — the deal timeline stores the raw `newValue` — the
        // marshaller rejects it ("Unsupported type") unless told to treat class
        // instances as maps. Without this, updating a deal's address 500s.
        convertClassInstanceToMap: true,
      },
    });
  }
}

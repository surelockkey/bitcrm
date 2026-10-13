import * as http from 'http';
import * as https from 'https';
import { DynamoDbService } from '../../../src/dynamodb/dynamodb.service';

// Records what the handler was built with. A subclass rather than a jest.fn:
// the SDK calls `NodeHttpHandler.create` on the same module for its defaults.
const mockHandlerOptions: unknown[] = [];
jest.mock('@smithy/node-http-handler', () => {
  const actual = jest.requireActual('@smithy/node-http-handler');
  class RecordingHandler extends actual.NodeHttpHandler {
    constructor(opts: unknown) {
      super(opts);
      if (opts !== undefined) mockHandlerOptions.push(opts);
    }
  }
  return { ...actual, NodeHttpHandler: RecordingHandler };
});

/**
 * The SDK's default handler caps a client at 50 sockets, and every service
 * shares ONE DynamoDB client — under a fan-out (names-by-ids, the reports) the
 * 51st request queues behind the others. The client is built with its own
 * keep-alive agents instead.
 */
describe('DynamoDbService', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    mockHandlerOptions.length = 0;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  function handlerOptions() {
    expect(mockHandlerOptions).toHaveLength(1);
    return mockHandlerOptions[0] as {
      httpAgent: http.Agent;
      httpsAgent: https.Agent;
      connectionTimeout: number;
      requestTimeout: number;
    };
  }

  it('uses keep-alive agents with 200 sockets by default', () => {
    delete process.env.DYNAMODB_MAX_SOCKETS;
    const service = new DynamoDbService();

    const opts = handlerOptions();
    expect(opts.httpsAgent).toBeInstanceOf(https.Agent);
    expect(opts.httpAgent).toBeInstanceOf(http.Agent);
    expect(opts.httpsAgent.maxSockets).toBe(200);
    expect(opts.httpAgent.maxSockets).toBe(200);
    expect((opts.httpsAgent as unknown as { keepAlive: boolean }).keepAlive).toBe(true);
    expect((opts.httpAgent as unknown as { keepAlive: boolean }).keepAlive).toBe(true);
    expect(opts.connectionTimeout).toBeGreaterThan(0);
    expect(opts.requestTimeout).toBeGreaterThan(0);
    expect(service.client.config.requestHandler).toBeInstanceOf(
      jest.requireActual('@smithy/node-http-handler').NodeHttpHandler,
    );
  });

  it('reads DYNAMODB_MAX_SOCKETS', () => {
    process.env.DYNAMODB_MAX_SOCKETS = '75';
    new DynamoDbService();

    const opts = handlerOptions();
    expect(opts.httpsAgent.maxSockets).toBe(75);
    expect(opts.httpAgent.maxSockets).toBe(75);
  });

  it.each(['', 'lots', '0', '-1'])('falls back to 200 on %p', (raw) => {
    process.env.DYNAMODB_MAX_SOCKETS = raw;
    new DynamoDbService();

    expect(handlerOptions().httpsAgent.maxSockets).toBe(200);
  });

  // DynamoDB Local is plain http — the http agent is what it rides on.
  it('keeps the local endpoint and its credentials', async () => {
    process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';
    const service = new DynamoDbService();

    const endpoint = await service.client.config.endpoint!();
    expect(endpoint.protocol).toBe('http:');
    expect(endpoint.hostname).toBe('localhost');
    expect(endpoint.port).toBe(8000);
    const creds = await service.client.config.credentials();
    expect(creds.accessKeyId).toBe('local');
  });

  it('keeps the marshal options the services rely on', async () => {
    const service = new DynamoDbService();

    const translate = (service.client.config as unknown as {
      translateConfig: { marshallOptions: Record<string, boolean> };
    }).translateConfig;
    expect(translate.marshallOptions).toEqual(
      expect.objectContaining({
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      }),
    );
  });
});

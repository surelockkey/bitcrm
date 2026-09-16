import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { Conversation, Message, MessageTemplate, OptOut } from '@bitcrm/types';

// ---------------------------------------------------------------------------
// Mocked document client: records every command, answers from a script
// ---------------------------------------------------------------------------
export interface SentCommand {
  /** `PutCommand`, `GetCommand`, `QueryCommand`, `UpdateCommand`, `TransactWriteCommand`, … */
  name: string;
  input: Record<string, any>;
}

export type ScriptedResponse = Record<string, any> | Error;

/**
 * `responses[i]` answers the i-th `send`; an `Error` entry is thrown instead.
 * Past the end of the script every call resolves `{}`.
 */
export function mockDynamo(responses: ScriptedResponse[] = []) {
  const sent: SentCommand[] = [];
  let i = 0;
  const send = jest.fn(async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    sent.push({ name: cmd.constructor.name, input: cmd.input });
    const res = responses[i++] ?? {};
    if (res instanceof Error) throw res;
    return res;
  });
  const dynamo = { client: { send } } as unknown as DynamoDbService;
  return { dynamo, sent, send };
}

export function conditionalCheckFailed(): Error {
  return new ConditionalCheckFailedException({
    $metadata: {},
    message: 'The conditional request failed',
  });
}

/**
 * The cancellation codes DynamoDB puts in `CancellationReasons`. Not just the
 * two the happy paths check: a transaction is also cancelled for reasons the
 * repository must rethrow untouched rather than mistake for a failed guard.
 */
export type CancellationCode =
  | 'None'
  | 'ConditionalCheckFailed'
  | 'ItemCollectionSizeLimitExceeded'
  | 'TransactionConflict'
  | 'ProvisionedThroughputExceeded'
  | 'ThrottlingError'
  | 'ValidationError';

/** One code per TransactItems entry, in order. */
export function transactionCanceled(codes: CancellationCode[]): Error {
  return new TransactionCanceledException({
    $metadata: {},
    message: 'Transaction cancelled, please refer cancellation reasons for specific reasons',
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------
export const T0 = '2026-09-15T10:00:00.000Z';
export const T1 = '2026-09-15T10:05:00.000Z';
export const NOW = new Date('2026-09-15T12:00:00.000Z');

export function createMockConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 'c1',
    kind: 'client',
    partyKind: 'contact',
    partyId: 'ct1',
    addresses: { phones: ['+14045551234'], emails: [] },
    state: 'open',
    unread: false,
    unreadCount: 0,
    flagged: false,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function createMockMessage(overrides?: Partial<Message>): Message {
  return {
    id: 'm1',
    conversationId: 'c1',
    channel: 'sms',
    direction: 'inbound',
    body: 'Hello',
    from: '+14045551234',
    to: '+15550001111',
    businessNumber: '+15550001111',
    status: 'received',
    provider: 'twilio',
    providerSid: 'SM1',
    origin: 'contact',
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  };
}

export function createMockTemplate(overrides?: Partial<MessageTemplate>): MessageTemplate {
  return {
    id: 't1',
    messageTemplateTitle: 'On My Way',
    messageTemplate: '<p>Hi {{first_name}}, on my way.</p>',
    isDefault: false,
    channel: 'sms',
    active: true,
    createdBy: 'u1',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function createMockOptOut(overrides?: Partial<OptOut>): OptOut {
  return {
    channel: 'sms',
    address: '+14045551234',
    status: 'opted_out',
    keyword: 'STOP',
    source: 'advanced_opt_out',
    updatedAt: T0,
    history: [{ status: 'opted_out', source: 'advanced_opt_out', keyword: 'STOP', at: T0 }],
    ...overrides,
  };
}

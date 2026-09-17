import { DynamoDbService } from '@bitcrm/shared';
import {
  CallsRepository,
  CallTagsConflictError,
} from '../../src/calls/calls.repository';

/**
 * `tagIds` on CALL# rows: written only by the compare-and-set `setTags`,
 * never by the lifecycle `upsert`, read back as-is by every read path.
 */
type SentCommand = { input: Record<string, any> };

function makeRepo(respond: (cmd: SentCommand) => unknown = async () => ({})) {
  const sent: SentCommand[] = [];
  const client = {
    send: jest.fn(async (cmd: SentCommand) => {
      sent.push(cmd);
      return respond(cmd);
    }),
  };
  const repo = new CallsRepository({ client } as unknown as DynamoDbService);
  return { repo, sent };
}

const conflict = () => {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
};

describe('CallsRepository.setTags', () => {
  it('sets the list and bumps updatedAt, guarded on the record having no tags yet', async () => {
    const { repo, sent } = makeRepo();
    await repo.setTags('CA1', ['t-spam', 't-tech'], undefined);

    const input = sent[0].input;
    expect(input.Key).toEqual({ PK: 'CALL#CA1', SK: 'METADATA' });
    expect(input.UpdateExpression).toBe('SET #tagIds = :tagIds, #updatedAt = :now');
    expect(input.ExpressionAttributeValues[':tagIds']).toEqual(['t-spam', 't-tech']);
    expect(input.ExpressionAttributeNames['#tagIds']).toBe('tagIds');
    // A phantom record for an unknown sid must never be minted here.
    expect(input.ConditionExpression).toBe(
      'attribute_exists(PK) AND attribute_not_exists(#tagIds)',
    );
  });

  it('compares against the list the caller read before overwriting it', async () => {
    const { repo, sent } = makeRepo();
    await repo.setTags('CA1', ['t-spam'], ['t-spam', 't-tech']);

    const input = sent[0].input;
    expect(input.ConditionExpression).toBe('attribute_exists(PK) AND #tagIds = :expected');
    expect(input.ExpressionAttributeValues[':expected']).toEqual(['t-spam', 't-tech']);
  });

  it('removes the attribute rather than storing an empty list', async () => {
    const { repo, sent } = makeRepo();
    await repo.setTags('CA1', [], ['t-spam']);

    const input = sent[0].input;
    expect(input.UpdateExpression).toBe('REMOVE #tagIds SET #updatedAt = :now');
    expect(input.ExpressionAttributeValues[':tagIds']).toBeUndefined();
  });

  it('turns a failed condition into a conflict the service can retry', async () => {
    const { repo } = makeRepo(async () => {
      throw conflict();
    });
    await expect(repo.setTags('CA1', ['t-spam'], undefined)).rejects.toBeInstanceOf(
      CallTagsConflictError,
    );
  });

  it('lets every other error through untouched', async () => {
    const { repo } = makeRepo(async () => {
      throw new Error('ProvisionedThroughputExceededException');
    });
    await expect(repo.setTags('CA1', ['t-spam'], undefined)).rejects.toThrow(
      /ProvisionedThroughput/,
    );
  });
});

describe('CallsRepository — tags and the lifecycle writer', () => {
  it('upsert never writes tagIds, so a webhook cannot clobber a curated list', async () => {
    const { repo, sent } = makeRepo();
    await repo.upsert({
      callSid: 'CA1',
      startedAt: '2026-09-16T10:00:00.000Z',
      updatedAt: '2026-09-16T10:00:00.000Z',
      status: 'completed',
      tagIds: ['t-spam'],
    });

    const names = Object.values(
      (sent[0].input.ExpressionAttributeNames ?? {}) as Record<string, string>,
    );
    expect(names).toContain('status');
    expect(names).not.toContain('tagIds');
  });

  it('reads tagIds back as stored on every read path', async () => {
    const item = {
      PK: 'CALL#CA1',
      SK: 'METADATA',
      callSid: 'CA1',
      startedAt: '2026-09-16T10:00:00.000Z',
      updatedAt: '2026-09-16T10:00:00.000Z',
      tagIds: ['t-spam', 't-tech'],
    };
    const { repo } = makeRepo(async (cmd) =>
      'Key' in cmd.input ? { Item: { ...item } } : { Items: [{ ...item }] },
    );

    expect((await repo.getBySid('CA1'))?.tagIds).toEqual(['t-spam', 't-tech']);
    expect((await repo.list({}, undefined, 5)).items[0].tagIds).toEqual([
      't-spam',
      't-tech',
    ]);
  });
});

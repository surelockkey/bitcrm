import { DynamoDbService } from '@bitcrm/shared';
import { CallsRepository, type ListCallsFilter } from '../../src/calls/calls.repository';

/**
 * Workiz's "+ Add filter" on the call log (callspage_wz_05_*): every panel is
 * a list of checkboxes, so each filter takes several values. One value keeps
 * the expression it always had (old links, old tests, the count cache); two
 * or more become an IN / an OR. Status also takes Workiz's categories —
 * Answered, Missed, Active, Voicemail — spelled out over our statuses with
 * the Call Tracking report's answer rule, so "Missed" selects exactly what
 * the MISSED CALLS card counts.
 */

type SentCommand = { input: Record<string, any> };

function makeRepo() {
  const sent: SentCommand[] = [];
  const client = {
    send: jest.fn(async (cmd: SentCommand) => {
      sent.push(cmd);
      return { Items: [] };
    }),
  };
  const repo = new CallsRepository({ client } as unknown as DynamoDbService);
  return { repo, sent };
}

async function inputFor(filter: ListCallsFilter) {
  const { repo, sent } = makeRepo();
  await repo.list(filter, undefined, 25);
  return sent[0].input;
}

/** The values an expression names, by placeholder, in the order it names them. */
function valuesIn(input: Record<string, any>, pattern: RegExp): unknown[] {
  return [...String(input.FilterExpression).matchAll(pattern)].map((m) => input.ExpressionAttributeValues[m[0]]);
}

describe('several values per filter', () => {
  it('a comma list of statuses is an IN', async () => {
    const input = await inputFor({ status: 'completed,busy' });

    expect(input.FilterExpression).toMatch(/#status IN \(:st0, :st1\)/);
    expect(valuesIn(input, /:st\d+/g)).toEqual(['completed', 'busy']);
  });

  it('one status keeps its old expression', async () => {
    const input = await inputFor({ status: 'completed' });

    expect(input.FilterExpression).toContain('#status = :status');
    expect(input.ExpressionAttributeValues[':status']).toBe('completed');
  });

  it('both directions are an IN; one keeps its old expression', async () => {
    expect((await inputFor({ direction: 'inbound' })).FilterExpression).toContain('#direction = :direction');

    const both = await inputFor({ direction: 'inbound,outbound' });
    expect(both.FilterExpression).toMatch(/#direction IN \(:dir0, :dir1\)/);
    expect(valuesIn(both, /:dir\d+/g)).toEqual(['inbound', 'outbound']);
  });

  it('several users are an IN over agentId; one keeps its old expression', async () => {
    expect((await inputFor({ agentId: 'u1' })).FilterExpression).toContain('agentId = :agentId');

    const many = await inputFor({ agentId: 'u1, u2,u3' });
    expect(many.FilterExpression).toMatch(/agentId IN \(:ag0, :ag1, :ag2\)/);
    expect(valuesIn(many, /:ag\d+/g)).toEqual(['u1', 'u2', 'u3']);
  });

  it('several tags match a call carrying ANY of them; one keeps its old expression', async () => {
    expect((await inputFor({ tagId: 't1' })).FilterExpression).toContain('contains(#tagIds, :tagId)');

    const many = await inputFor({ tagId: 't1,t2' });
    expect(many.FilterExpression).toContain('(contains(#tagIds, :tag0) OR contains(#tagIds, :tag1))');
    expect(many.ExpressionAttributeValues[':tag0']).toBe('t1');
    expect(many.ExpressionAttributeValues[':tag1']).toBe('t2');
  });

  it('drops blanks and repeats, so "a,,a" is one value', async () => {
    const input = await inputFor({ agentId: 'u1,,u1, ' });

    expect(input.FilterExpression).toContain('agentId = :agentId');
    expect(input.ExpressionAttributeValues[':agentId']).toBe('u1');
  });

  it('a list of nothing filters nothing', async () => {
    expect((await inputFor({ status: ' , ', tagId: ',' })).FilterExpression).toBe('attribute_not_exists(internalLegOf)');
  });
});

describe('Workiz status categories', () => {
  it('Active = the live statuses', async () => {
    const input = await inputFor({ status: 'active' });

    expect(input.FilterExpression).toMatch(/#status IN \(:live0, :live1, :live2, :live3\)/);
    expect(valuesIn(input, /:live\d/g)).toEqual(['queued', 'initiated', 'ringing', 'in-progress']);
  });

  it('Missed = inbound, by the Call Tracking rule for imported and for our own calls', async () => {
    const input = await inputFor({ status: 'missed' });
    const f = String(input.FilterExpression);
    const v = input.ExpressionAttributeValues;

    expect(f).toContain('#direction = :catInbound');
    expect(v[':catInbound']).toBe('inbound');
    // Imported: Workiz's dial status — empty or no-answer, an empty one the voicemail box took excepted.
    expect(f).toContain('begins_with(#externalId, :wzCall)');
    expect(v[':wzCall']).toBe('workiz:call:');
    expect(f).toContain('#dialCallStatus = :dialNoAnswer');
    expect(v[':dialNoAnswer']).toBe('no-answer');
    expect(f).toContain('attribute_not_exists(#dialCallStatus) OR #dialCallStatus = :empty');
    expect(f).toContain('NOT #voicemail = :vmBox');
    expect(v[':vmBox']).toBe(2);
    // Ours: nobody picked up, and it is over.
    expect(f).toContain('NOT (attribute_exists(#answeredAt) OR #status = :completed)');
    expect(f).toContain('NOT #status IN (:live0, :live1, :live2, :live3)');
  });

  it('Answered = Workiz’s completed dial on an imported inbound call, else somebody picked up', async () => {
    const f = String((await inputFor({ status: 'answered' })).FilterExpression);

    expect(f).toContain('#dialCallStatus = :dialCompleted');
    expect(f).toContain('attribute_exists(#answeredAt) OR #status = :completed');
  });

  it('Voicemail = an inbound call that left a message (imported: Workiz’s voicemail flag)', async () => {
    const input = await inputFor({ status: 'voicemail' });
    const f = String(input.FilterExpression);

    expect(f).toContain('#voicemail > :zero');
    expect(f).toContain('attribute_exists(#recordingSid)');
    expect(f).toContain('#direction = :catInbound');
  });

  it('categories and raw statuses are ORed together', async () => {
    const input = await inputFor({ status: 'missed,active,busy' });
    const f = String(input.FilterExpression);

    // One parenthesised OR, ANDed with the rest.
    expect(f.startsWith('attribute_not_exists(internalLegOf) AND (')).toBe(true);
    expect(f).toContain('#status IN (:st0)');
    expect(input.ExpressionAttributeValues[':st0']).toBe('busy');
    expect(f.split(' OR ').length).toBeGreaterThan(2);
  });
});

describe('the other Workiz panels, where the call row holds the answer', () => {
  it('Call Flow → flowId IN', async () => {
    const input = await inputFor({ flowId: 'f1,f2' });

    expect(input.FilterExpression).toMatch(/#flowId IN \(:flow0, :flow1\)/);
    expect(input.ExpressionAttributeNames['#flowId']).toBe('flowId');
  });

  it('Ad Group → sourceId IN', async () => {
    const input = await inputFor({ sourceId: 's1' });

    expect(input.FilterExpression).toMatch(/#sourceId IN \(:src0\)/);
    expect(input.ExpressionAttributeValues[':src0']).toBe('s1');
  });

  it('Duration: a floor needs talk time; a ceiling lets a call with none through', async () => {
    const input = await inputFor({ minDuration: 61, maxDuration: 179 });
    const f = String(input.FilterExpression);

    expect(f).toContain('#durationSeconds >= :minDuration');
    expect(f).toContain('(attribute_not_exists(#durationSeconds) OR #durationSeconds <= :maxDuration)');
    expect(input.ExpressionAttributeValues[':minDuration']).toBe(61);
    expect(input.ExpressionAttributeValues[':maxDuration']).toBe(179);
  });

  it('Masking calls: Yes = our masked bridge or Workiz’s masking flag; No = neither', async () => {
    const yes = await inputFor({ masked: true });
    expect(yes.FilterExpression).toContain('(#origin = :bridge OR #isMasking = :masked)');
    expect(yes.ExpressionAttributeValues[':bridge']).toBe('bridge');
    expect(yes.ExpressionAttributeValues[':masked']).toBe(true);

    const no = await inputFor({ masked: false });
    expect(no.FilterExpression).toContain('NOT (#origin = :bridge OR #isMasking = :masked)');
  });

  it('Job Status → "All with job": a linked deal or a Workiz job id', async () => {
    const withJob = await inputFor({ hasJob: true });
    expect(withJob.FilterExpression).toContain('(attribute_exists(#dealId) OR attribute_exists(#workizJobId))');

    const without = await inputFor({ hasJob: false });
    expect(without.FilterExpression).toContain('(attribute_not_exists(#dealId) AND attribute_not_exists(#workizJobId))');
  });

  it('every filter at once still ANDs into one expression the count shares', async () => {
    const filter: ListCallsFilter = {
      status: 'missed,busy',
      direction: 'inbound',
      agentId: 'u1,u2',
      tagId: 't1,t2',
      flowId: 'f1',
      sourceId: 's1',
      minDuration: 1,
      maxDuration: 30,
      masked: false,
      hasJob: true,
    };
    const listed = await inputFor(filter);

    const { repo, sent } = makeRepo();
    await repo.count(filter);
    expect(sent[0].input.FilterExpression).toBe(listed.FilterExpression);
    expect(sent[0].input.ExpressionAttributeValues).toMatchObject(
      Object.fromEntries(Object.entries(listed.ExpressionAttributeValues).filter(([k]) => k !== ':allPk')),
    );
  });
});

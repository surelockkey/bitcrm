import { AutoSentRepository } from '../../../src/automations/auto-sent.repository';
import { mockDynamo, T1 } from '../mocks';

describe('AutoSentRepository', () => {
  it('reads AUTOSENT#<dealId> / <ruleId>#<techId>', async () => {
    const { dynamo, sent } = mockDynamo([
      { Item: { PK: 'AUTOSENT#d1', SK: 'new-job-sms#t1', dealId: 'd1', ruleId: 'new-job-sms', techId: 't1', scheduledDate: '2026-09-20', conversationId: 'c1', messageId: 'm1', sentAt: T1 } },
      {},
    ]);
    const repo = new AutoSentRepository(dynamo);
    expect(await repo.get('d1', 'new-job-sms', 't1')).toEqual({
      dealId: 'd1', ruleId: 'new-job-sms', techId: 't1', scheduledDate: '2026-09-20', conversationId: 'c1', messageId: 'm1', sentAt: T1,
    });
    expect(sent[0]).toMatchObject({ name: 'GetCommand', input: { Key: { PK: 'AUTOSENT#d1', SK: 'new-job-sms#t1' } } });
    expect(await repo.get('d1', 'new-job-sms', 't2')).toBeNull();
  });

  it('writes the marker keeping an empty scheduledDate explicit', async () => {
    const { dynamo, sent } = mockDynamo();
    const repo = new AutoSentRepository(dynamo);
    await repo.put({ dealId: 'd1', ruleId: 'new-job-sms', techId: 't1', scheduledDate: '', conversationId: 'c1', messageId: 'm1', sentAt: T1 });
    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input.Item).toEqual({
      PK: 'AUTOSENT#d1', SK: 'new-job-sms#t1', dealId: 'd1', ruleId: 'new-job-sms', techId: 't1', scheduledDate: '', conversationId: 'c1', messageId: 'm1', sentAt: T1,
    });
  });
});

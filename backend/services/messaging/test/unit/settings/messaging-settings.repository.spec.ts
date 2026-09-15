import { MessagingSettingsRepository } from '../../../src/settings/messaging-settings.repository';
import { T1, mockDynamo } from '../mocks';

function makeRepo(responses: Parameters<typeof mockDynamo>[0] = []) {
  const { dynamo, sent } = mockDynamo(responses);
  return { repo: new MessagingSettingsRepository(dynamo), sent };
}

describe('MessagingSettingsRepository', () => {
  it('is null until first saved', async () => {
    const { repo, sent } = makeRepo([{}]);
    expect(await repo.get()).toBeNull();
    expect(sent[0].input.Key).toEqual({ PK: 'MESSAGING#SETTINGS', SK: 'METADATA' });
  });

  it('puts the singleton with audit stamps and no empty strings', async () => {
    const { repo, sent } = makeRepo([{}]);
    const saved = await repo.put(
      { defaultSenderNumber: '+15550001111', smsPre: '', quietHours: { from: '20:00', to: '08:00', timezone: 'America/New_York' } },
      'u1',
      T1,
    );
    expect(saved).toEqual({
      defaultSenderNumber: '+15550001111',
      smsPre: '',
      quietHours: { from: '20:00', to: '08:00', timezone: 'America/New_York' },
      updatedAt: T1,
      updatedBy: 'u1',
    });
    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input.Item).toEqual({
      PK: 'MESSAGING#SETTINGS',
      SK: 'METADATA',
      defaultSenderNumber: '+15550001111',
      quietHours: { from: '20:00', to: '08:00', timezone: 'America/New_York' },
      updatedAt: T1,
      updatedBy: 'u1',
    });
  });

  it('reads the document back without key attributes', async () => {
    const { repo } = makeRepo([{ Item: { PK: 'MESSAGING#SETTINGS', SK: 'METADATA', smsFormat: 'New job #{{job_id}}', updatedAt: T1 } }]);
    expect(await repo.get()).toEqual({ smsFormat: 'New job #{{job_id}}', updatedAt: T1 });
  });
});

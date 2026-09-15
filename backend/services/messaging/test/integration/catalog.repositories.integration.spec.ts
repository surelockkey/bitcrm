import { DynamoDbService } from '@bitcrm/shared';
import { type MessageTemplate } from '@bitcrm/types';
import { InboxCountersRepository } from 'src/counters/inbox-counters.repository';
import { OptOutsRepository } from 'src/opt-outs/opt-outs.repository';
import { MessagingSettingsRepository } from 'src/settings/messaging-settings.repository';
import { MessageTemplatesRepository } from 'src/templates/message-templates.repository';
import {
  MESSAGING_TEST_TABLE,
  clearTestTable,
  createTestTables,
  destroyRawClient,
  getTestDynamoDbClient,
} from './setup';

/** Real DynamoDB Local (:8001): opt-outs, templates, settings, counters. */
describe('catalog repositories (integration)', () => {
  let optOuts: OptOutsRepository;
  let templates: MessageTemplatesRepository;
  let settings: MessagingSettingsRepository;
  let counters: InboxCountersRepository;

  beforeAll(async () => {
    await createTestTables();
    const dynamo = { client: getTestDynamoDbClient() } as unknown as DynamoDbService;
    optOuts = new OptOutsRepository(dynamo);
    templates = new MessageTemplatesRepository(dynamo);
    settings = new MessagingSettingsRepository(dynamo);
    counters = new InboxCountersRepository(dynamo);
    for (const r of [optOuts, templates, settings, counters]) (r as any).tableName = MESSAGING_TEST_TABLE;
  });

  afterAll(() => destroyRawClient());

  beforeEach(async () => {
    await clearTestTable(MESSAGING_TEST_TABLE);
  });

  it('opt-outs: STOP then START keeps the ledger', async () => {
    expect(await optOuts.isOptedOut('sms', '+14045551234')).toBe(false);
    await optOuts.setStatus({ channel: 'sms', address: '+14045551234', status: 'opted_out', source: 'advanced_opt_out', keyword: 'STOP' });
    expect(await optOuts.isOptedOut('sms', '+14045551234')).toBe(true);
    expect(await optOuts.isOptedOut('email', '+14045551234')).toBe(false);

    const row = await optOuts.setStatus({ channel: 'sms', address: '+14045551234', status: 'opted_in', source: 'advanced_opt_out', keyword: 'START' });
    expect(row.history.map((h) => h.keyword)).toEqual(['START', 'STOP']);
    expect(await optOuts.get('sms', '+14045551234')).toEqual(row);
  });

  it('templates: catalog listing is alphabetical and hides archived rows', async () => {
    const t = (id: string, title: string, active = true): MessageTemplate => ({
      id,
      messageTemplateTitle: title,
      messageTemplate: `<p>${title}</p>`,
      isDefault: false,
      channel: 'any',
      active,
      createdBy: 'u1',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    await templates.create(t('t1', 'Running late'));
    await templates.create(t('t2', 'On my way'));
    await templates.create(t('t3', 'Archived one', false));
    await expect(templates.create(t('t1', 'dup'))).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });

    expect((await templates.list()).map((x) => x.id)).toEqual(['t2', 't1']);
    expect((await templates.list({ includeInactive: true })).map((x) => x.id)).toEqual(['t3', 't2', 't1']);

    await templates.archive('t2');
    expect((await templates.list()).map((x) => x.id)).toEqual(['t1']);
    expect(await templates.get('t2')).toMatchObject({ active: false });
    await templates.remove('t1');
    expect(await templates.get('t1')).toBeNull();
  });

  it('settings: singleton put/get', async () => {
    expect(await settings.get()).toBeNull();
    const saved = await settings.put({ defaultSenderNumber: '+15550001111', smsFormat: 'New job #{{job_id}}' }, 'u1');
    expect(await settings.get()).toEqual(saved);
  });

  it('counters: ADD creates the item and accumulates per kind', async () => {
    await counters.add({ unreadConversations: 2, unreadByKind: { client: 1, team: 1 } });
    await counters.add({ unreadConversations: -1, flaggedConversations: 3, unreadByKind: { team: -1 } });
    expect(await counters.get()).toEqual({ unreadConversations: 1, flaggedConversations: 3, unreadByKind: { client: 1 } });
    await counters.set({ unreadConversations: 0, flaggedConversations: 0, unreadByKind: {} });
    expect(await counters.get()).toEqual({ unreadConversations: 0, flaggedConversations: 0, unreadByKind: {} });
  });
});

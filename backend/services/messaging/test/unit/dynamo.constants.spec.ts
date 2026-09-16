import {
  MESSAGING_GSI1_NAME,
  MESSAGING_GSI2_NAME,
  MESSAGING_GSI3_NAME,
  MESSAGING_GSI4_NAME,
  MESSAGING_GSI5_NAME,
  MESSAGING_GSI6_NAME,
  MESSAGING_GSIS,
  MESSAGING_TTL_ATTRIBUTE,
  conversationPk,
  messageSk,
  parseMessageSk,
  readMarkerSk,
  memberSk,
  convOfPk,
  addressPk,
  providerSidPk,
  clientMessagePk,
  optOutPk,
  templatePk,
  templateCatalogSk,
  TEMPLATE_CATALOG_GSI3PK,
  SETTINGS_PK,
  COUNTERS_PK,
  yearOf,
  inboxGsi1Pk,
  unreadGsi2Pk,
  categoryGsi3Pk,
  jobGsi4Pk,
  FLAG_CONVERSATION_GSI5PK,
  flagMessageGsi5Pk,
  accountCategoryGsi6Pk,
  activitySk,
  messageIndexSk,
} from '../../src/common/constants/dynamo.constants';
import { messagingTableDefinition, messagingTableTtl } from '../../src/common/messaging-table.schema';

/**
 * Locks the key shapes of design §3.1–3.2. Terraform (another change) creates
 * the same index names and GSI<n>PK/GSI<n>SK attributes; a rename here
 * without one there would silently query a non-existent index.
 */
describe('messaging table key shapes', () => {
  it('names the six indexes exactly as the design and Terraform do', () => {
    expect(MESSAGING_GSIS.map((g) => g.name)).toEqual([
      'InboxIndex',
      'UnreadIndex',
      'CategoryIndex',
      'JobIndex',
      'FlagIndex',
      'AccountCategoryIndex',
    ]);
    expect([
      MESSAGING_GSI1_NAME,
      MESSAGING_GSI2_NAME,
      MESSAGING_GSI3_NAME,
      MESSAGING_GSI4_NAME,
      MESSAGING_GSI5_NAME,
      MESSAGING_GSI6_NAME,
    ]).toEqual(MESSAGING_GSIS.map((g) => g.name));
    expect(MESSAGING_TTL_ATTRIBUTE).toBe('expiresAt');
  });

  it('declares GSI<n>PK / GSI<n>SK string attributes for every index plus TTL', () => {
    const def = messagingTableDefinition('X');
    const attrs = def.AttributeDefinitions!.map((a) => a.AttributeName);
    expect(attrs).toEqual([
      'PK', 'SK',
      'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK',
      'GSI4PK', 'GSI4SK', 'GSI5PK', 'GSI5SK', 'GSI6PK', 'GSI6SK',
    ]);
    expect(def.GlobalSecondaryIndexes!.map((g) => g.IndexName)).toEqual(
      MESSAGING_GSIS.map((g) => g.name),
    );
    for (const gsi of def.GlobalSecondaryIndexes!) {
      expect(gsi.Projection).toEqual({ ProjectionType: 'ALL' });
    }
    expect(def.BillingMode).toBe('PAY_PER_REQUEST');
    expect(messagingTableTtl('X')).toEqual({
      TableName: 'X',
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
  });

  it('builds conversation and message keys', () => {
    expect(conversationPk('c1')).toBe('CONV#c1');
    expect(messageSk('2026-09-15T10:00:00.000Z', 'm1')).toBe('MSG#2026-09-15T10:00:00.000Z#m1');
    expect(parseMessageSk('MSG#2026-09-15T10:00:00.000Z#m1')).toEqual({
      createdAt: '2026-09-15T10:00:00.000Z',
      messageId: 'm1',
    });
    expect(() => parseMessageSk('READ#u1')).toThrow();
    expect(readMarkerSk('u1')).toBe('READ#u1');
    expect(memberSk('u1')).toBe('MEMBER#u1');
  });

  it('builds the pointer and service item keys', () => {
    expect(convOfPk('contact', 'ct1')).toBe('CONVOF#contact#ct1');
    expect(convOfPk('address', '+14045551234')).toBe('CONVOF#address#+14045551234');
    expect(addressPk('+14045551234')).toBe('ADDR#+14045551234');
    expect(providerSidPk('SM123')).toBe('PSID#SM123');
    expect(clientMessagePk('uuid')).toBe('CLIENTMSG#uuid');
    expect(optOutPk('sms', '+14045551234')).toBe('OPTOUT#sms#+14045551234');
    expect(templatePk('t1')).toBe('TEMPLATE#t1');
    expect(TEMPLATE_CATALOG_GSI3PK).toBe('CATALOG#MESSAGE_TEMPLATE');
    expect(templateCatalogSk('  On My Way ', 't1')).toBe('on my way#t1');
    expect(SETTINGS_PK).toBe('MESSAGING#SETTINGS');
    expect(COUNTERS_PK).toBe('INBOX#COUNTERS');
  });

  it('builds the year-bucketed index keys', () => {
    expect(yearOf('2026-09-15T10:00:00.000Z')).toBe('2026');
    expect(inboxGsi1Pk('open', '2026')).toBe('INBOX#open#2026');
    expect(inboxGsi1Pk('archived', '2025')).toBe('INBOX#archived#2025');
    expect(unreadGsi2Pk('2026')).toBe('UNREAD#2026');
    expect(categoryGsi3Pk('team', '2026')).toBe('CAT#team#2026');
    expect(jobGsi4Pk('d1')).toBe('JOB#d1');
    expect(FLAG_CONVERSATION_GSI5PK).toBe('FLAG#conversation');
    expect(flagMessageGsi5Pk('2026')).toBe('FLAG#message#2026');
    expect(accountCategoryGsi6Pk('151892', '2026')).toBe('ACCTCAT#151892#2026');
    expect(activitySk('2026-09-15T10:00:00.000Z', 'c1')).toBe('2026-09-15T10:00:00.000Z#c1');
    expect(messageIndexSk('2026-09-15T10:00:00.000Z', 'm1')).toBe('2026-09-15T10:00:00.000Z#m1');
  });
});

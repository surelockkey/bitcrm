import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { SecuritySettingsRepository } from '../../../src/security/security-settings.repository';
import { createMockDynamoDbClient } from '../mocks';

/**
 * The account's security settings are one row of the users table
 * (`SETTINGS / SECURITY`), absent until someone saves the Security Center;
 * every change is appended under `AUDIT#SECURITY_SETTINGS`.
 */
describe('SecuritySettingsRepository', () => {
  let repository: SecuritySettingsRepository;
  let dbClient: ReturnType<typeof createMockDynamoDbClient>;

  beforeEach(async () => {
    dbClient = createMockDynamoDbClient();
    const module = await Test.createTestingModule({
      providers: [SecuritySettingsRepository, { provide: DynamoDbService, useValue: { client: dbClient } }],
    }).compile();
    repository = module.get(SecuritySettingsRepository);
  });

  describe('get', () => {
    it('answers the defaults — nothing required, nothing by email — when no row was ever saved', async () => {
      dbClient.send.mockResolvedValue({});

      await expect(repository.get()).resolves.toEqual({ requireMfa: false, loginCodeByEmail: false, otpByEmail: false });
      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.TableName).toBe('BitCRM_Users');
      expect(input.Key).toEqual({ PK: 'SETTINGS', SK: 'SECURITY' });
    });

    it('reads the switches and who last saved them, never the keys', async () => {
      dbClient.send.mockResolvedValue({
        Item: {
          PK: 'SETTINGS',
          SK: 'SECURITY',
          requireMfa: true,
          loginCodeByEmail: false,
          otpByEmail: true,
          updatedAt: '2026-10-09T10:00:00.000Z',
          updatedBy: 'u-admin',
        },
      });

      await expect(repository.get()).resolves.toEqual({
        requireMfa: true,
        loginCodeByEmail: false,
        otpByEmail: true,
        updatedAt: '2026-10-09T10:00:00.000Z',
        updatedBy: 'u-admin',
      });
    });
  });

  it('put writes the one row under SETTINGS / SECURITY', async () => {
    dbClient.send.mockResolvedValue({});

    await repository.put({ requireMfa: true, loginCodeByEmail: true, otpByEmail: false, updatedAt: 'now', updatedBy: 'u-1' });

    const input = dbClient.send.mock.calls[0][0].input;
    expect(input.TableName).toBe('BitCRM_Users');
    expect(input.Item).toEqual({
      PK: 'SETTINGS',
      SK: 'SECURITY',
      requireMfa: true,
      loginCodeByEmail: true,
      otpByEmail: false,
      updatedAt: 'now',
      updatedBy: 'u-1',
    });
  });

  it('recordChange appends who flipped what, keyed by time so the log reads in order', async () => {
    dbClient.send.mockResolvedValue({});
    const before = { requireMfa: false, loginCodeByEmail: false, otpByEmail: false };
    const after = { requireMfa: true, loginCodeByEmail: false, otpByEmail: false };

    await repository.recordChange({ actorId: 'u-admin', timestamp: '2026-10-09T10:00:00.000Z', before, after });

    const input = dbClient.send.mock.calls[0][0].input;
    expect(input.Item.PK).toBe('AUDIT#SECURITY_SETTINGS');
    expect(input.Item.SK).toMatch(/^2026-10-09T10:00:00\.000Z#[0-9a-f-]{36}$/);
    expect(input.Item).toMatchObject({ actorId: 'u-admin', timestamp: '2026-10-09T10:00:00.000Z', before, after });
  });

  it('listChanges reads the newest first', async () => {
    dbClient.send.mockResolvedValue({
      Items: [
        {
          PK: 'AUDIT#SECURITY_SETTINGS',
          SK: '2026-10-09T10:00:00.000Z#x',
          actorId: 'u-admin',
          timestamp: '2026-10-09T10:00:00.000Z',
          before: { requireMfa: false, loginCodeByEmail: false, otpByEmail: false },
          after: { requireMfa: true, loginCodeByEmail: false, otpByEmail: false },
        },
      ],
    });

    const rows = await repository.listChanges(20);

    const input = dbClient.send.mock.calls[0][0].input;
    expect(input.KeyConditionExpression).toBe('PK = :pk');
    expect(input.ExpressionAttributeValues).toEqual({ ':pk': 'AUDIT#SECURITY_SETTINGS' });
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(20);
    expect(rows).toEqual([
      {
        actorId: 'u-admin',
        timestamp: '2026-10-09T10:00:00.000Z',
        before: { requireMfa: false, loginCodeByEmail: false, otpByEmail: false },
        after: { requireMfa: true, loginCodeByEmail: false, otpByEmail: false },
      },
    ]);
  });
});

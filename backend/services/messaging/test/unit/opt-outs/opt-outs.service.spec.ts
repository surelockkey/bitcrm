import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { OptOut } from '@bitcrm/types';
import { OptOutsService } from '../../../src/opt-outs/opt-outs.service';
import { T0, createMockOptOut } from '../mocks';

function makeService(rows: OptOut[] = []) {
  const store = new Map(rows.map((r) => [`${r.channel}#${r.address}`, r]));
  const repo = {
    get: jest.fn(async (channel: string, address: string) => store.get(`${channel}#${address}`) ?? null),
    put: jest.fn(async (row: OptOut) => void store.set(`${row.channel}#${row.address}`, row)),
    remove: jest.fn(async (channel: string, address: string) => void store.delete(`${channel}#${address}`)),
    setStatus: jest.fn(async (input) => {
      const row: OptOut = {
        channel: input.channel,
        address: input.address,
        status: input.status,
        keyword: input.keyword,
        source: input.source,
        updatedAt: input.at ?? '2026-09-15T12:00:00.000Z',
        updatedBy: input.by,
        history: [],
      };
      store.set(`${row.channel}#${row.address}`, row);
      return row;
    }),
  };
  const sns = { publish: jest.fn(async () => undefined) };
  const metrics = {
    entityCreated: { inc: jest.fn() },
    entityUpdated: { inc: jest.fn() },
    entityDeleted: { inc: jest.fn() },
    eventsPublished: { inc: jest.fn() },
    eventsFailed: { inc: jest.fn() },
  };
  return { service: new OptOutsService(repo as any, sns as any, metrics as any), repo, store, sns, metrics };
}

const caller = { id: 'admin' };

describe('OptOutsService', () => {
  describe('normalizeAddress', () => {
    it('normalises phones to E.164 and emails to lowercase', () => {
      const { service } = makeService();
      expect(service.normalizeAddress('sms', '(404) 555-1234')).toBe('+14045551234');
      expect(service.normalizeAddress('sms', ' +1 404 555 1234 ')).toBe('+14045551234');
      expect(service.normalizeAddress('email', ' Jane@Example.COM ')).toBe('jane@example.com');
    });

    it('rejects what is not an address for the channel', () => {
      const { service } = makeService();
      expect(() => service.normalizeAddress('sms', 'jane@example.com')).toThrow(BadRequestException);
      expect(() => service.normalizeAddress('email', '+14045551234')).toThrow(BadRequestException);
      expect(() => service.assertChannel('fax')).toThrow(BadRequestException);
      expect(service.assertChannel('email')).toBe('email');
    });
  });

  describe('lookup / get', () => {
    it('checks a phone as sms and an email as email', async () => {
      const { service, repo } = makeService([createMockOptOut(), createMockOptOut({ channel: 'email', address: 'a@b.co' })]);
      expect((await service.lookup('404-555-1234')).map((r) => r.channel)).toEqual(['sms']);
      expect(repo.get).toHaveBeenLastCalledWith('sms', '+14045551234');
      expect((await service.lookup('A@B.co')).map((r) => r.address)).toEqual(['a@b.co']);
      expect(await service.lookup('+15550000000')).toEqual([]);
      await expect(service.lookup('???')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s on a never-opted-out address', async () => {
      const { service } = makeService();
      await expect(service.get('sms', '+15550000000')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('set / remove', () => {
    it('records a manual flip with the caller and publishes opt-out.changed', async () => {
      const { service, repo, sns, metrics } = makeService();
      const row = await service.set('sms', '404 555 1234', { status: 'opted_in', keyword: 'START' }, caller);
      expect(repo.setStatus).toHaveBeenCalledWith({
        channel: 'sms',
        address: '+14045551234',
        status: 'opted_in',
        source: 'manual',
        keyword: 'START',
        by: 'admin',
      });
      expect(row.status).toBe('opted_in');
      expect(metrics.entityUpdated.inc).toHaveBeenCalledWith({ entity_type: 'opt_out' });
      await Promise.resolve();
      expect(sns.publish).toHaveBeenCalledWith('message-events', 'opt_out.changed', {
        channel: 'sms',
        address: '+14045551234',
        status: 'opted_in',
        source: 'manual',
      });
    });

    it('never lets a failed publish fail the write', async () => {
      const { service, sns } = makeService();
      sns.publish.mockRejectedValueOnce(new Error('sns down'));
      await expect(service.set('email', 'x@y.co', { status: 'opted_out' }, caller)).resolves.toMatchObject({ status: 'opted_out' });
    });

    it('removes the normalised key', async () => {
      const { service, repo, store } = makeService([createMockOptOut()]);
      await service.remove('sms', '(404) 555-1234', caller);
      expect(repo.remove).toHaveBeenCalledWith('sms', '+14045551234');
      expect(store.size).toBe(0);
    });
  });

  describe('import', () => {
    it('writes new rows with a single history entry, skips existing ones, reports invalid addresses', async () => {
      const { service, repo, store } = makeService([createMockOptOut()]);
      const result = await service.import(
        {
          items: [
            { address: '+14045551234', channel: 'sms' }, // exists → skipped
            { address: '(404) 555-9999', channel: 'sms', keyword: 'STOP', at: T0 },
            { address: 'Client@Example.com', channel: 'email', status: 'opted_out', source: 'ses_complaint' },
            { address: 'not-a-phone', channel: 'sms' },
          ],
        },
        caller,
      );
      expect(result).toEqual({
        imported: 2,
        skipped: 1,
        invalid: [{ address: 'not-a-phone', channel: 'sms', reason: '"not-a-phone" is not a phone number' }],
      });
      expect(store.get('sms#+14045559999')).toEqual({
        channel: 'sms',
        address: '+14045559999',
        status: 'opted_out',
        keyword: 'STOP',
        source: 'workiz_import',
        updatedAt: T0,
        updatedBy: 'admin',
        history: [{ status: 'opted_out', source: 'workiz_import', keyword: 'STOP', at: T0, by: 'admin' }],
      });
      expect(store.get('email#client@example.com')).toMatchObject({ source: 'ses_complaint', status: 'opted_out' });
      expect(repo.put).toHaveBeenCalledTimes(2);
      // The existing row was left alone (no unconditional Put over it).
      expect(store.get('sms#+14045551234')?.source).toBe('advanced_opt_out');
    });

    it('overwrites on request and collapses duplicates within the batch (last wins)', async () => {
      const { service, repo, store, metrics } = makeService([createMockOptOut()]);
      const result = await service.import(
        {
          overwrite: true,
          items: [
            { address: '+14045551234', channel: 'sms', status: 'opted_in' },
            { address: '404-555-1234', channel: 'sms', status: 'opted_out', keyword: 'QUIT' },
          ],
        },
        caller,
      );
      expect(result).toEqual({ imported: 1, skipped: 0, invalid: [] });
      expect(repo.get).not.toHaveBeenCalled();
      expect(store.get('sms#+14045551234')).toMatchObject({ status: 'opted_out', keyword: 'QUIT', source: 'workiz_import' });
      expect(metrics.entityCreated.inc).toHaveBeenCalledWith({ entity_type: 'opt_out' }, 1);
    });

    it('handles a large batch in bounded parallel chunks', async () => {
      const { service, repo } = makeService();
      const items = Array.from({ length: 120 }, (_, i) => ({
        address: `+1404555${String(i).padStart(4, '0')}`,
        channel: 'sms' as const,
      }));
      const result = await service.import({ items }, caller);
      expect(result.imported).toBe(120);
      expect(repo.put).toHaveBeenCalledTimes(120);
    });
  });
});

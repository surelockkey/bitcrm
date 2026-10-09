import { BadRequestException } from '@nestjs/common';
import { TelephonySettingsService } from '../../src/telephony/telephony-settings.service';

/**
 * Workiz's "Fallback Number" (the first row of its Call flows tab): the one
 * outside number a call goes to when its flow ends unanswered. Any phone
 * number — the owner's mobile, an answering service — so, unlike the
 * technician line, it is not checked against the numbers we own.
 */
function makeService(item?: Record<string, unknown>) {
  let stored: Record<string, unknown> | undefined = item;
  const sent: Array<Record<string, unknown>> = [];
  const client = {
    send: jest.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push(cmd.input);
      if (cmd.constructor.name === 'GetCommand') return { Item: stored };
      const expr = String(cmd.input.UpdateExpression);
      const values = (cmd.input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
      stored = { ...(stored ?? {}) };
      if (expr.includes('REMOVE fallbackNumber')) delete stored.fallbackNumber;
      else if (expr.includes('fallbackNumber')) stored.fallbackNumber = values[':n'];
      stored.updatedAt = values[':now'];
      return {};
    }),
  };
  const numbers = { listOwned: jest.fn().mockResolvedValue([{ phoneNumber: '+14098777774' }]) };
  const service = new TelephonySettingsService({ client } as never, numbers as never);
  return { service, sent, read: () => stored, numbers };
}

describe('TelephonySettingsService — fallback number', () => {
  it('is unset until somebody adds one', async () => {
    const { service } = makeService();
    await expect(service.fallbackNumber()).resolves.toBeNull();
    await expect(service.get()).resolves.toEqual({ technicianLine: null, fallbackNumber: null });
  });

  it('stores whatever was typed as E.164 and reads it back', async () => {
    const { service, read } = makeService();
    const after = await service.setFallbackNumber('(888) 899-6849');
    expect(after.fallbackNumber).toBe('+18888996849');
    expect(read()?.fallbackNumber).toBe('+18888996849');
    service.forget();
    await expect(service.fallbackNumber()).resolves.toBe('+18888996849');
  });

  it('may be a number we do not own — it is where calls LEAVE to', async () => {
    const { service, numbers } = makeService();
    await expect(service.setFallbackNumber('+15550001111')).resolves.toMatchObject({ fallbackNumber: '+15550001111' });
    expect(numbers.listOwned).not.toHaveBeenCalled();
  });

  it('refuses something that is not a phone number', async () => {
    const { service } = makeService();
    await expect(service.setFallbackNumber('call me')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is removed with null, leaving the technician line alone', async () => {
    const { service, read } = makeService({ technicianLine: '+14098777774', fallbackNumber: '+18888996849' });
    const after = await service.setFallbackNumber(null);
    expect(after).toEqual({ technicianLine: '+14098777774', fallbackNumber: null });
    expect(read()).toEqual({ technicianLine: '+14098777774', updatedAt: expect.any(String) });
  });

  it('reads both settings from the one row', async () => {
    const { service } = makeService({ technicianLine: '+14098777774', fallbackNumber: '+18888996849' });
    await expect(service.get()).resolves.toEqual({ technicianLine: '+14098777774', fallbackNumber: '+18888996849' });
  });
});

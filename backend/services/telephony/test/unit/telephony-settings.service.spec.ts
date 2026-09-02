import { BadRequestException } from '@nestjs/common';
import { TelephonySettingsService } from '../../src/telephony/telephony-settings.service';

const OWNED = ['+14098777774', '+15412830739'];

function makeService(over: { item?: Record<string, unknown> | undefined; owned?: string[] } = {}) {
  /** One row, keyed the way the service keys it. */
  let stored: Record<string, unknown> | undefined =
    over.item === undefined ? undefined : over.item;

  const sent: Array<Record<string, unknown>> = [];
  const client = {
    send: jest.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push(cmd.input);
      if (cmd.constructor.name === 'GetCommand') return { Item: stored };
      // UpdateCommand — apply it to the fake row.
      const expr = String(cmd.input.UpdateExpression);
      const values = (cmd.input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
      stored = { ...(stored ?? {}) };
      if (expr.startsWith('REMOVE technicianLine')) delete stored.technicianLine;
      else stored.technicianLine = values[':n'];
      return {};
    }),
  };
  const numbers = {
    listOwned: jest
      .fn()
      .mockResolvedValue((over.owned ?? OWNED).map((phoneNumber) => ({ phoneNumber }))),
  };
  const service = new TelephonySettingsService(
    { client } as never,
    numbers as never,
  );
  return { service, numbers, client, sent, read: () => stored };
}

describe('TelephonySettingsService', () => {
  it('reports no technician line before one is chosen', async () => {
    const { service } = makeService();
    await expect(service.technicianLine()).resolves.toBeNull();
  });

  it('designates a number and reads it back', async () => {
    const { service } = makeService();

    await service.setTechnicianLine('+14098777774');
    service.forget();

    await expect(service.technicianLine()).resolves.toBe('+14098777774');
  });

  it('normalises whatever format the operator typed', async () => {
    const { service, read } = makeService();

    await service.setTechnicianLine('(409) 877-7774');

    expect(read()?.technicianLine).toBe('+14098777774');
  });

  /**
   * The constraint held as a shape rather than enforced: one row can only name
   * one number, so designating a second clears the first with no sweep and no
   * uniqueness index that could drift.
   */
  it('only ever holds one line — a second designation replaces the first', async () => {
    const { service, read } = makeService();

    await service.setTechnicianLine('+14098777774');
    await service.setTechnicianLine('+15412830739');

    expect(read()?.technicianLine).toBe('+15412830739');
    service.forget();
    await expect(service.technicianLine()).resolves.toBe('+15412830739');
  });

  it('clears the line when set to null', async () => {
    const { service } = makeService();
    await service.setTechnicianLine('+14098777774');

    await service.setTechnicianLine(null);
    service.forget();

    await expect(service.technicianLine()).resolves.toBeNull();
  });

  /**
   * Caller id is never validated at dial time, so a number the workspace does
   * not hold would surface weeks later as a technician whose call just fails.
   */
  it('refuses a number the workspace does not own', async () => {
    const { service } = makeService();

    await expect(service.setTechnicianLine('+17705559999')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses something that is not a phone number', async () => {
    const { service } = makeService();

    await expect(service.setTechnicianLine('not-a-number')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('does not block when the owned-number list is unavailable', async () => {
    // Twilio being unreachable must not stop an operator configuring the line.
    const { service, read } = makeService({ owned: [] });

    await service.setTechnicianLine('+14098777774');

    expect(read()?.technicianLine).toBe('+14098777774');
  });

  it('caches reads so the inbound hot path is not a round trip per call', async () => {
    const { service, client } = makeService({ item: { technicianLine: '+14098777774' } });

    await service.technicianLine();
    await service.technicianLine();
    await service.technicianLine();

    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache on write, so a change takes effect at once', async () => {
    const { service } = makeService({ item: { technicianLine: '+14098777774' } });
    await service.technicianLine();

    await service.setTechnicianLine('+15412830739');

    await expect(service.technicianLine()).resolves.toBe('+15412830739');
  });

  /**
   * Treating a read failure as "unset" would send callers down the
   * ring-everyone fallback the inbound guard exists to prevent.
   */
  it('serves the last known value when the table is unreadable', async () => {
    const { service, client } = makeService({ item: { technicianLine: '+14098777774' } });
    await service.technicianLine();

    // Let the memo lapse, THEN break the table — `forget()` would be the wrong
    // setup here, since dropping the memo is exactly what leaves nothing to
    // fall back to.
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow + 60_000);
    client.send.mockRejectedValue(new Error('dynamo down'));

    await expect(service.technicianLine()).resolves.toBe('+14098777774');
    jest.restoreAllMocks();
  });

  it('reports no line when it has never managed to read one', async () => {
    const { service, client } = makeService();
    client.send.mockRejectedValue(new Error('dynamo down'));

    await expect(service.technicianLine()).resolves.toBeNull();
  });
});

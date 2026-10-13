import { CallDevicesRepository } from 'src/call-devices/call-devices.repository';

/**
 * Devices imported from Workiz were written in the import's own shape —
 * `friendlyName` and `phone` instead of `name` and `number`. Read back as-is,
 * they had no name, and sorting the list by name threw, so every call-groups
 * page (which lists devices beside members) answered 500.
 */
function build(items: Record<string, unknown>[]) {
  const send = jest.fn(async () => ({ Items: items }));
  return new CallDevicesRepository({ client: { send } } as never);
}

describe('CallDevicesRepository — imported Workiz rows', () => {
  it('reads friendlyName as the name and phone as the number', async () => {
    const repo = build([
      {
        PK: 'DEVICE', SK: 'DEVICE#d1', id: 'd1', friendlyName: 'SURE CT LOCKSMITH', phone: '+12039893585',
        isOwnNumber: true, externalId: 'workiz:device:7', createdBy: 'u-import', createdAt: '2026-01-01',
      },
    ]);

    const [d] = await repo.listAll();

    expect(d).toMatchObject({ id: 'd1', name: 'SURE CT LOCKSMITH', number: '+12039893585' });
    expect(d).not.toHaveProperty('PK');
  });

  it('falls back to the phone, then the id, when there is no friendly name either', async () => {
    const repo = build([
      { PK: 'DEVICE', SK: 'DEVICE#d1', id: 'd1', phone: '+12039893585' },
      { PK: 'DEVICE', SK: 'DEVICE#d2', id: 'd2' },
    ]);

    const [a, b] = await repo.listAll();

    expect(a.name).toBe('+12039893585');
    expect(b.name).toBe('d2');
  });

  it('leaves a device written by BitCRM exactly as stored', async () => {
    const stored = {
      id: 'd1', name: 'Front desk', number: '+12039893585', type: 'desk_phone', active: false,
      createdBy: 'u', createdAt: '', updatedAt: '',
    };
    const repo = build([{ PK: 'DEVICE', SK: 'DEVICE#d1', ...stored }]);

    const [d] = await repo.listAll();

    expect(d).toEqual(stored);
  });

  it('does not invent routing fields (active, type) for imported rows', async () => {
    const repo = build([{ PK: 'DEVICE', SK: 'DEVICE#d1', id: 'd1', friendlyName: 'Shop', phone: '+12039893585' }]);

    const [d] = await repo.listAll();

    expect(d).not.toHaveProperty('active');
    expect(d).not.toHaveProperty('type');
  });
});

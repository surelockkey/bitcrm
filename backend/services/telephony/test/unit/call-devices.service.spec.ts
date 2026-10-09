import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CallDevicesService } from 'src/call-devices/call-devices.service';
import type { CallDevice } from '@bitcrm/types';

/**
 * Workiz's Devices: the shop lines and desk phones a group or a Forward step
 * rings beside the softphones. A device is a name and a number (or a SIP
 * address) — nothing else is stored, so a renamed line is one edit.
 */
function build(seed: CallDevice[] = []) {
  const store = new Map(seed.map((d) => [d.id, structuredClone(d)]));
  const repository = {
    listAll: jest.fn(async () => [...store.values()]),
    get: jest.fn(async (id: string) => store.get(id) ?? null),
    create: jest.fn(async (d: CallDevice) => void store.set(d.id, d)),
    put: jest.fn(async (d: CallDevice) => void store.set(d.id, d)),
    delete: jest.fn(async (id: string) => void store.delete(id)),
  };
  return { service: new CallDevicesService(repository as never), repository, store };
}

const caller = { id: 'u-admin' };

const device = (over: Partial<CallDevice> = {}): CallDevice => ({
  id: 'd1',
  name: 'SURE CT LOCKSMITH',
  number: '+12039893585',
  type: 'shop_line',
  active: true,
  createdBy: 'u-import',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('CallDevicesService', () => {
  describe('create', () => {
    it('stores the number in E.164 whatever way it was typed, desk phone by default', async () => {
      const { service, store } = build();

      const created = await service.create({ name: 'Front desk', number: '(203) 989-3585' }, caller);

      expect(created).toMatchObject({ name: 'Front desk', number: '+12039893585', type: 'desk_phone', active: true });
      expect(store.get(created.id)).toMatchObject({ number: '+12039893585', createdBy: 'u-admin' });
    });

    it('takes a SIP address instead of a number', async () => {
      const { service } = build();
      const created = await service.create({ name: 'Shop SIP', sipAddress: 'shop@sip.example.com', type: 'other' }, caller);
      expect(created).toMatchObject({ sipAddress: 'shop@sip.example.com', type: 'other' });
      expect(created).not.toHaveProperty('number');
    });

    it('refuses a device with nothing to ring', async () => {
      const { service } = build();
      await expect(service.create({ name: 'Nothing' }, caller)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a number that is not a phone number', async () => {
      const { service } = build();
      await expect(service.create({ name: 'Bad', number: '12' }, caller)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a second device with the same name, whatever the casing', async () => {
      const { service } = build([device()]);
      await expect(
        service.create({ name: '  sure ct locksmith ', number: '+12035550100' }, caller),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a type it does not know', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'X', number: '+12035550100', type: 'fax' as never }, caller),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reading', () => {
    it('lists by name and finds one', async () => {
      const { service } = build([device({ id: 'd2', name: 'TECH LINE CTM' }), device()]);
      expect((await service.list()).map((d) => d.name)).toEqual(['SURE CT LOCKSMITH', 'TECH LINE CTM']);
      expect((await service.findById('d2')).name).toBe('TECH LINE CTM');
      await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
      // The runner's read: null, never a throw, mid-call.
      await expect(service.findRaw('nope')).resolves.toBeNull();
    });
  });

  describe('update', () => {
    it('changes what is sent and keeps the rest', async () => {
      const { service, store } = build([device()]);

      const updated = await service.update('d1', { name: 'CT shop line', active: false }, caller);

      expect(updated).toMatchObject({ name: 'CT shop line', number: '+12039893585', active: false, updatedBy: 'u-admin' });
      expect(store.get('d1')).toMatchObject({ name: 'CT shop line' });
    });

    it('will not take away the only thing a device rings on', async () => {
      const { service } = build([device()]);
      await expect(service.update('d1', { number: null }, caller)).rejects.toBeInstanceOf(BadRequestException);
      // …but swapping to a SIP address in the same edit is fine.
      const swapped = await service.update('d1', { number: null, sipAddress: 'a@b.c' }, caller);
      expect(swapped).not.toHaveProperty('number');
      expect(swapped.sipAddress).toBe('a@b.c');
    });

    it('keeps names unique on rename, ignoring the device itself', async () => {
      const { service } = build([device(), device({ id: 'd2', name: 'TECH LINE CTM' })]);
      await expect(service.update('d2', { name: 'sure ct locksmith' }, caller)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.update('d2', { name: 'Tech Line CTM' }, caller)).resolves.toMatchObject({ name: 'Tech Line CTM' });
    });
  });

  it('removes a device; groups and flows that named it simply skip it', async () => {
    const { service, store } = build([device()]);
    await service.remove('d1');
    expect(store.has('d1')).toBe(false);
    await expect(service.remove('d1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('says how a device is rung: its number, or sip:<address>', () => {
    expect(CallDevicesService.endpointOf(device())).toBe('+12039893585');
    expect(CallDevicesService.endpointOf(device({ number: undefined, sipAddress: 'shop@sip.example.com' }))).toBe(
      'sip:shop@sip.example.com',
    );
  });
});

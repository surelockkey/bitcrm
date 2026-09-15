import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '@bitcrm/shared';
import { NumbersController } from '../../src/numbers/numbers.controller';
import { InternalGuard } from '../../src/common/guards/internal.guard';
import { type OwnedNumberDetails } from '../../src/numbers/numbers.service';
import { type NumberSettings } from '../../src/numbers/number-settings.repository';

/**
 * `GET /numbers/internal/owned` is what the messaging service reads to pick
 * a sender: every owned number, whether it can text, which Messaging Service
 * pools it, and which job source it is tracked as.
 */

const detailed = (over: Partial<OwnedNumberDetails> = {}): OwnedNumberDetails => ({
  sid: 'PN1',
  phoneNumber: '+15550000001',
  friendlyName: 'Main line',
  voiceUrl: 'https://api.example.test/api/telephony/voice/inbound',
  smsUrl: '',
  capabilities: { sms: true, mms: true, voice: true },
  ...over,
});

function makeController(
  over: {
    owned?: OwnedNumberDetails[];
    membership?: Map<string, string>;
    settings?: NumberSettings[] | Error;
  } = {},
) {
  const numbers = {
    listOwnedDetailed: jest.fn().mockResolvedValue(over.owned ?? [detailed()]),
    messagingServiceMembership: jest
      .fn()
      .mockResolvedValue(over.membership ?? new Map<string, string>()),
    listOwned: jest.fn(),
  };
  const numberSettings = {
    list:
      over.settings instanceof Error
        ? jest.fn().mockRejectedValue(over.settings)
        : jest.fn().mockResolvedValue(over.settings ?? []),
  };
  const controller = new NumbersController(
    numbers as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    numberSettings as never,
  );
  return { controller, numbers, numberSettings };
}

describe('NumbersController.internalOwned', () => {
  it('is an internal route: public to Cognito, gated by the internal secret', () => {
    const handler = NumbersController.prototype.internalOwned;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('internal/owned');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([InternalGuard]);
  });

  it('maps each owned number with its capabilities, pool and job source', async () => {
    const { controller } = makeController({
      owned: [
        detailed(),
        detailed({
          sid: 'PN2',
          phoneNumber: '+15550000002',
          friendlyName: 'Google Ads',
          capabilities: { sms: true, mms: false, voice: true },
        }),
        detailed({
          sid: 'PN3',
          phoneNumber: '+15550000003',
          friendlyName: 'Voice only',
          capabilities: { sms: false, mms: false, voice: true },
        }),
      ],
      membership: new Map([
        ['+15550000001', 'MGpool'],
        ['+15550000002', 'MGpool'],
      ]),
      settings: [
        { phoneNumber: '+15550000002', sourceId: 'src-google-ads' },
        { phoneNumber: '+15550000009', sourceId: 'src-stale' }, // no longer owned
        { phoneNumber: '+15550000003' }, // settings row without a source
      ],
    });

    const res = await controller.internalOwned();

    expect(res.success).toBe(true);
    expect(res.data).toEqual([
      {
        phoneNumber: '+15550000001',
        sid: 'PN1',
        friendlyName: 'Main line',
        capabilities: { sms: true, mms: true, voice: true },
        messagingServiceSid: 'MGpool',
        sourceId: undefined,
      },
      {
        phoneNumber: '+15550000002',
        sid: 'PN2',
        friendlyName: 'Google Ads',
        capabilities: { sms: true, mms: false, voice: true },
        messagingServiceSid: 'MGpool',
        sourceId: 'src-google-ads',
      },
      {
        phoneNumber: '+15550000003',
        sid: 'PN3',
        friendlyName: 'Voice only',
        capabilities: { sms: false, mms: false, voice: true },
        messagingServiceSid: undefined,
        sourceId: undefined,
      },
    ]);
    // Unknowns are absent on the wire, not null.
    expect(JSON.parse(JSON.stringify(res.data[2]))).not.toHaveProperty('messagingServiceSid');
    expect(JSON.parse(JSON.stringify(res.data[2]))).not.toHaveProperty('sourceId');
  });

  it('exposes only the documented fields (no voice/sms URLs)', async () => {
    const { controller } = makeController();
    const [row] = (await controller.internalOwned()).data;
    expect(Object.keys(row).sort()).toEqual(
      ['capabilities', 'friendlyName', 'messagingServiceSid', 'phoneNumber', 'sid', 'sourceId'].sort(),
    );
  });

  it('still lists the numbers when the settings table is unreachable', async () => {
    const { controller } = makeController({
      settings: new Error('ResourceNotFoundException'),
    });
    const res = await controller.internalOwned();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].sourceId).toBeUndefined();
  });

  it('reads the three sources concurrently, once each', async () => {
    const { controller, numbers, numberSettings } = makeController();
    await controller.internalOwned();
    expect(numbers.listOwnedDetailed).toHaveBeenCalledTimes(1);
    expect(numbers.messagingServiceMembership).toHaveBeenCalledTimes(1);
    expect(numberSettings.list).toHaveBeenCalledTimes(1);
    expect(numbers.listOwned).not.toHaveBeenCalled();
  });
});

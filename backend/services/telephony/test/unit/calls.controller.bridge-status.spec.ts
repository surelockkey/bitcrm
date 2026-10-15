import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { IS_PUBLIC_KEY, PERMISSION_KEY } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { CallsController } from '../../src/calls/calls.controller';
import { BridgeService } from '../../src/common/bridge.service';
import { CONFIG, FakeRedis } from './helpers/conference-harness';

/** Twilio, as the controller reaches it: `new TwilioRest(config).run(c => …)`. */
const mockTwilio = {
  callsCreate: jest.fn(),
  callUpdate: jest.fn(),
  updatedSids: [] as string[],
};
jest.mock('@bitcrm/shared', () => {
  const actual = jest.requireActual('@bitcrm/shared');
  class FakeTwilioRest {
    run(fn: (c: unknown) => Promise<unknown>) {
      const client = {
        calls: Object.assign(
          (sid: string) => ({
            update: (body: unknown) => {
              mockTwilio.updatedSids.push(sid);
              return mockTwilio.callUpdate(body);
            },
          }),
          { create: mockTwilio.callsCreate },
        ),
      };
      return fn(client);
    }
  }
  return { ...actual, TwilioRest: FakeTwilioRest };
});

const TECH = { id: 'tech-1', roleId: 'role-technician' } as JwtUser;
const OTHER = { id: 'tech-2', roleId: 'role-technician' } as JwtUser;

function make() {
  const redis = new FakeRedis();
  const bridge = new BridgeService(
    { client: redis } as never,
    {
      find: jest.fn().mockResolvedValue({
        id: 'deal-1',
        dealNumber: 'K4T9ZW',
        contactId: 'contact-1',
        assignedTechIds: ['tech-1'],
      }),
    } as never,
    {
      phonesOf: jest.fn().mockResolvedValue({ phones: ['+12035550177'], name: 'Maria Alvarez' }),
    } as never,
    { forServerLeg: jest.fn().mockResolvedValue({ callerId: '+14045550100', source: 'area' }) } as never,
    { activeCallFor: jest.fn().mockResolvedValue(null) } as never,
  );
  const calls = { applyLifecycle: jest.fn().mockResolvedValue(undefined) };
  const directory = { find: jest.fn().mockResolvedValue({ id: 'tech-1', phone: '+380501234567' }) };
  const controller = new CallsController(
    calls as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    directory as never,
    {} as never,
    bridge,
    { listOnline: jest.fn().mockResolvedValue([]) } as never,
    CONFIG,
  );
  return { controller, bridge, redis, calls };
}

/** The one bridge a test started, read off the state key it left in Redis. */
const trackedBridgeId = (redis: FakeRedis) =>
  [...redis.hashes.keys()].find((k) => k.startsWith('telephony:bridge:state:'))!.split(':').pop()!;

const start = (controller: CallsController) =>
  controller.startBridge({ dealId: 'deal-1', contactId: 'contact-1', via: 'cell' }, TECH);

beforeEach(() => {
  mockTwilio.callsCreate.mockReset().mockResolvedValue({ sid: 'CAtech' });
  mockTwilio.callUpdate.mockReset().mockResolvedValue({});
  mockTwilio.updatedSids = [];
});

/**
 * GET /calls/bridge/:bridgeId — what the phone polls after "Call client".
 * The answer is `{state, reason?}` and nothing else; only the user who
 * started the bridge gets one, everyone else the same 404 as an unknown id.
 */
describe('CallsController.bridgeStatus', () => {
  it('tells the user who started the bridge where it stands', async () => {
    const { controller, bridge } = make();
    const { data } = await start(controller);
    await bridge.advance(data.bridgeId, () => ({
      state: 'failed',
      reason: 'Your number could not be reached from the company line',
    }));

    await expect(controller.bridgeStatus(data.bridgeId, TECH)).resolves.toEqual({
      success: true,
      data: { state: 'failed', reason: 'Your number could not be reached from the company line' },
    });
  });

  it('404s anyone else, so a bridge id cannot be probed', async () => {
    const { controller } = make();
    const { data } = await start(controller);

    await expect(controller.bridgeStatus(data.bridgeId, OTHER)).rejects.toThrow(NotFoundException);
  });

  it('404s an unknown or expired bridge', async () => {
    const { controller } = make();

    await expect(controller.bridgeStatus('no-such-bridge', TECH)).rejects.toThrow(NotFoundException);
  });

  it('is guarded exactly like POST /calls/bridge — signed in, no permission, not public', () => {
    const proto = CallsController.prototype;
    expect(Reflect.getMetadata(PERMISSION_KEY, proto.bridgeStatus)).toEqual(
      Reflect.getMetadata(PERMISSION_KEY, proto.startBridge),
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.bridgeStatus)).toBeUndefined();
    expect(Reflect.getMetadata('path', proto.bridgeStatus)).toBe('bridge/:bridgeId');
  });
});

describe('CallsController.startBridge — the progress the phone will read', () => {
  it('is open at "ringing your phone" before the leg is placed', async () => {
    const { controller, bridge, redis } = make();
    let seenAtCreate: unknown;
    mockTwilio.callsCreate.mockImplementation(async () => {
      // Twilio may report a refused leg before create returns; the record
      // must already be there to take it.
      seenAtCreate = await bridge.statusFor(trackedBridgeId(redis), TECH.id);
      return { sid: 'CAtech' };
    });

    const { data } = await start(controller);

    expect(seenAtCreate).toEqual({ state: 'ringing_you' });
    await expect(bridge.ringingLeg(data.bridgeId)).resolves.toBe('CAtech');
  });

  it('a leg Twilio refuses outright leaves a failure, not a phone ringing for nobody', async () => {
    const { controller, bridge, redis } = make();
    mockTwilio.callsCreate.mockRejectedValue(new Error('Account not authorized to call +380501234567'));

    await expect(start(controller)).rejects.toThrow();

    expect(await bridge.statusFor(trackedBridgeId(redis), TECH.id)).toEqual({
      state: 'failed',
      reason: 'Your number could not be reached',
    });
  });
});

describe('CallsController.cancelBridge — Cancel while the technician’s phone rings', () => {
  it('hangs up the ringing leg and reads as ended', async () => {
    const { controller, bridge } = make();
    const { data } = await start(controller);

    await expect(controller.cancelBridge(data.bridgeId, TECH)).resolves.toEqual({
      success: true,
      data: { cancelled: true },
    });

    expect(mockTwilio.updatedSids).toEqual(['CAtech']);
    expect(mockTwilio.callUpdate).toHaveBeenCalledWith({ status: 'canceled' });
    expect(await bridge.statusFor(data.bridgeId, TECH.id)).toEqual({ state: 'ended' });
  });
});

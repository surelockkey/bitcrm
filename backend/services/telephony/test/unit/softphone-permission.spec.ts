import 'reflect-metadata';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { TelephonyController } from '../../src/telephony/telephony.controller';
import { PresenceController } from '../../src/presence/presence.controller';

/**
 * The softphone — the header phone that makes and takes calls in the browser —
 * is its own switch, `calls.phone`, so a role (Logistics) can work without a
 * phone. Both doors to it check it: the Twilio token the browser dials with,
 * and the presence that puts a person in the pool inbound calls ring.
 */
describe('the softphone switch (calls.phone)', () => {
  it('guards the Twilio token', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, TelephonyController.prototype.token)).toEqual({
      resource: 'calls',
      action: 'phone',
    });
  });

  it('guards going online for inbound calls', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, PresenceController.prototype.set)).toEqual({
      resource: 'calls',
      action: 'phone',
    });
  });
});

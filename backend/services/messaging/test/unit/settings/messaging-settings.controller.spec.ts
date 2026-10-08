import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MessagingSettingsController } from '../../../src/settings/messaging-settings.controller';
import { InternalGuard } from '../../../src/common/guards/internal.guard';

/**
 * The workspace's main number for telephony's `GET /telephony/config` — the
 * pill beside "Workiz Phone" on the call log. It is the default sender
 * (Settings → Messaging → Default number), which `GET /settings` keeps behind
 * `settings.view`; this internal route hands telephony that ONE number and
 * nothing else, so every calls viewer sees the pill.
 */
describe('MessagingSettingsController.mainNumberInternal', () => {
  const make = (stored: Record<string, unknown>) => {
    const service = { get: jest.fn(async () => stored) };
    return new MessagingSettingsController(service as never);
  };

  it('answers the default sender as the main number', async () => {
    const out = await make({ defaultSenderNumber: '+12034036303', companyPhone: '+18005550100', smsFormat: 'x' }).mainNumberInternal();

    expect(out).toEqual({ success: true, data: { mainNumber: '+12034036303' } });
  });

  it('null until one is set', async () => {
    expect(await make({}).mainNumberInternal()).toEqual({ success: true, data: { mainNumber: null } });
  });

  it('is an internal route — the secret, not a user grant', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, MessagingSettingsController.prototype.mainNumberInternal) ?? [];

    expect(guards).toContain(InternalGuard);
  });
});

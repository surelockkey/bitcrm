import { SenderResolver } from '../../../src/outbound/sender.resolver';
import { type OwnedNumberInfo } from '../../../src/outbound/internal/telephony-numbers.client';
import { createMockConversation } from '../mocks';

const owned = (overrides: Partial<OwnedNumberInfo> & { phoneNumber: string }): OwnedNumberInfo => ({
  sid: `PN${overrides.phoneNumber}`,
  capabilities: { sms: true, mms: true, voice: true },
  messagingServiceSid: 'MG1',
  ...overrides,
});

function makeResolver(opts: {
  owned?: OwnedNumberInfo[];
  deal?: Record<string, unknown> | null;
  areaCallerId?: string;
  settingsSender?: string;
  defaultSender?: string;
  messagingServiceSid?: string;
} = {}) {
  const numbers = { listOwned: jest.fn(async () => opts.owned ?? []) };
  const deals = {
    find: jest.fn(async () => opts.deal ?? null),
    serviceAreaCallerId: jest.fn(async () => opts.areaCallerId),
  };
  const settings = { get: jest.fn(async () => (opts.settingsSender ? { defaultSenderNumber: opts.settingsSender } : null)) };
  const resolver = new SenderResolver(
    numbers as any,
    deals as any,
    settings as any,
    { messagingServiceSid: opts.messagingServiceSid ?? 'MG1' },
    { defaultSender: opts.defaultSender },
  );
  return { resolver, numbers, deals, settings };
}

const A = '+14045550001';
const B = '+14045550002';
const C = '+14045550003';
const D = '+14045550004';

describe('SenderResolver', () => {
  it("takes the agent's pick first when it is an allowed number", async () => {
    const { resolver } = makeResolver({ owned: [owned({ phoneNumber: A }), owned({ phoneNumber: B })] });
    const r = await resolver.resolve({ requested: B, conversation: createMockConversation({ lastBusinessNumber: A }) });
    expect(r).toEqual({ from: B, source: 'agent' });
  });

  it('falls through to the sticky number when the pick is not SMS-ready', async () => {
    const { resolver } = makeResolver({
      owned: [owned({ phoneNumber: A }), owned({ phoneNumber: B, capabilities: { sms: false, mms: false, voice: true } })],
    });
    const r = await resolver.resolve({ requested: B, conversation: createMockConversation({ lastBusinessNumber: A }) });
    expect(r).toEqual({ from: A, source: 'sticky' });
  });

  it('skips a number pooled in another Messaging Service', async () => {
    const { resolver } = makeResolver({
      owned: [owned({ phoneNumber: A, messagingServiceSid: 'MGother' }), owned({ phoneNumber: C })],
      deal: { id: 'd1', serviceAreaId: 'sa1', assignedTechIds: [] },
      areaCallerId: C,
    });
    const r = await resolver.resolve({ conversation: createMockConversation({ lastBusinessNumber: A }), dealId: 'd1' });
    expect(r).toEqual({ from: C, source: 'area' });
  });

  it('uses the job service-area caller id, then the source tracking number', async () => {
    const withArea = makeResolver({
      owned: [owned({ phoneNumber: C }), owned({ phoneNumber: D, sourceId: 'src1' })],
      deal: { id: 'd1', serviceAreaId: 'sa1', sourceId: 'src1', assignedTechIds: [] },
      areaCallerId: C,
    });
    expect(await withArea.resolver.resolve({ conversation: createMockConversation(), dealId: 'd1' })).toEqual({ from: C, source: 'area' });
    expect(withArea.deals.serviceAreaCallerId).toHaveBeenCalledWith('sa1');

    const noArea = makeResolver({
      owned: [owned({ phoneNumber: C }), owned({ phoneNumber: D, sourceId: 'src1' })],
      deal: { id: 'd1', sourceId: 'src1', assignedTechIds: [] },
    });
    expect(await noArea.resolver.resolve({ conversation: createMockConversation(), dealId: 'd1' })).toEqual({ from: D, source: 'source' });
  });

  it('falls back to the settings default, then the env default, then the pool', async () => {
    const settings = makeResolver({ owned: [owned({ phoneNumber: A }), owned({ phoneNumber: B })], settingsSender: B, defaultSender: A });
    expect(await settings.resolver.resolve({ conversation: createMockConversation() })).toEqual({ from: B, source: 'default' });

    const env = makeResolver({ owned: [owned({ phoneNumber: A })], defaultSender: A });
    expect(await env.resolver.resolve({ conversation: createMockConversation() })).toEqual({ from: A, source: 'default' });

    const pool = makeResolver({ owned: [owned({ phoneNumber: A })] });
    expect(await pool.resolver.resolve({ conversation: createMockConversation() })).toEqual({ source: 'pool' });
  });

  it('does not refuse every candidate when telephony is unreachable (empty owned list = unknown)', async () => {
    const { resolver } = makeResolver({ owned: [] });
    const r = await resolver.resolve({ requested: B, conversation: createMockConversation() });
    expect(r).toEqual({ from: B, source: 'agent' });
  });

  it('ignores candidates that are not E.164 and does not read the deal without a dealId', async () => {
    const { resolver, deals } = makeResolver({ owned: [owned({ phoneNumber: A })], defaultSender: A });
    const r = await resolver.resolve({ requested: 'not-a-number', conversation: createMockConversation({ lastBusinessNumber: '404' }) });
    expect(r).toEqual({ from: A, source: 'default' });
    expect(deals.find).not.toHaveBeenCalled();
  });

  it('survives a settings read failure', async () => {
    const { resolver, settings } = makeResolver({ owned: [owned({ phoneNumber: A })], defaultSender: A });
    settings.get.mockRejectedValueOnce(new Error('dynamo down'));
    expect(await resolver.resolve({ conversation: createMockConversation() })).toEqual({ from: A, source: 'default' });
  });

  it('lists the numbers the composer may offer', async () => {
    const { resolver } = makeResolver({
      owned: [
        owned({ phoneNumber: A }),
        owned({ phoneNumber: B, capabilities: { sms: false, mms: false, voice: true } }),
        owned({ phoneNumber: C, messagingServiceSid: undefined }),
        owned({ phoneNumber: D, messagingServiceSid: 'MGother' }),
      ],
    });
    expect((await resolver.allowedNumbers()).map((n) => n.phoneNumber)).toEqual([A, C]);
  });
});

import { CallerIdResolver } from '../../src/voice/caller-id.resolver';

const OWNED = ['+14045550100', '+19125550200', '+15555550000'];

function makeResolver(
  over: {
    areaCallerId?: string;
    owned?: string[];
    defaultAreaCallerId?: string;
    twilioCallerId?: string;
  } = {},
) {
  const areaNumbers = {
    callerIdFor: jest.fn().mockResolvedValue(over.areaCallerId),
  };
  const numbers = {
    listOwned: jest
      .fn()
      .mockResolvedValue(
        (over.owned ?? OWNED).map((phoneNumber) => ({ phoneNumber })),
      ),
  };
  const config = {
    callerId: over.twilioCallerId ?? '',
    defaultAreaCallerId: over.defaultAreaCallerId ?? '',
  };
  const resolver = new CallerIdResolver(
    areaNumbers as never,
    numbers as never,
    config as never,
  );
  return { resolver, areaNumbers, numbers };
}

const deal = (serviceAreaId?: string) => ({ serviceAreaId }) as never;

describe('CallerIdResolver — server-placed legs', () => {
  it("uses the job's market number", async () => {
    const { resolver } = makeResolver({ areaCallerId: '+19125550200' });

    const out = await resolver.forServerLeg(deal('area-sav'));

    expect(out).toEqual({ callerId: '+19125550200', source: 'area' });
  });

  it('falls back to the configured default when the market has no number', async () => {
    const { resolver } = makeResolver({ defaultAreaCallerId: '+14045550100' });

    const out = await resolver.forServerLeg(deal('area-none'));

    expect(out).toEqual({ callerId: '+14045550100', source: 'default' });
  });

  it('falls back to the workspace caller id, then to the first owned number', async () => {
    const withTwilio = makeResolver({ twilioCallerId: '+15555550000' });
    expect(await withTwilio.resolver.forServerLeg(deal())).toEqual({
      callerId: '+15555550000',
      source: 'default',
    });

    const bare = makeResolver();
    expect(await bare.resolver.forServerLeg(deal())).toEqual({
      callerId: '+14045550100',
      source: 'owned',
    });
  });

  /**
   * Caller id is never checked against account ownership at dial time — the
   * existing `pickCallerId` is a regex sanity filter and says so. A market
   * pointed at a released number would otherwise hang up on a real client.
   */
  it('skips a market number the workspace no longer owns', async () => {
    const { resolver } = makeResolver({
      areaCallerId: '+17705559999',
      twilioCallerId: '+15555550000',
    });

    const out = await resolver.forServerLeg(deal('area-atl'));

    expect(out).toEqual({ callerId: '+15555550000', source: 'default' });
  });

  it('never refuses a call for want of a caller id', async () => {
    const { resolver } = makeResolver({ owned: [] });

    const out = await resolver.forServerLeg(deal());

    expect(out.callerId).toBeUndefined();
    expect(out.source).toBeUndefined();
  });

  it('survives the market catalog being unreachable', async () => {
    const { resolver, areaNumbers } = makeResolver({
      twilioCallerId: '+15555550000',
    });
    areaNumbers.callerIdFor.mockRejectedValue(new Error('deal-service down'));

    const out = await resolver.forServerLeg(deal('area-atl'));

    expect(out).toEqual({ callerId: '+15555550000', source: 'default' });
  });

  it('does not consult the catalog for a job with no market', async () => {
    const { resolver, areaNumbers } = makeResolver({
      twilioCallerId: '+15555550000',
    });

    await resolver.forServerLeg(deal(undefined));

    expect(areaNumbers.callerIdFor).not.toHaveBeenCalled();
  });
});

/**
 * The dialer disagrees with the server chain ON PURPOSE. An agent's explicit
 * pick wins, because the shipped rationale is that clients answer the number
 * they already know — and only the system's own legs are about a market.
 */
describe('CallerIdResolver — the human dialer', () => {
  it("honours the agent's explicit pick", async () => {
    const { resolver } = makeResolver({ areaCallerId: '+19125550200' });

    const out = await resolver.forDialer('+14045550100', deal('area-sav'));

    expect(out).toEqual({ callerId: '+14045550100', source: 'agent' });
  });

  it('ignores a pick that is not a plausible E.164', async () => {
    const { resolver } = makeResolver({ areaCallerId: '+19125550200' });

    const out = await resolver.forDialer('not-a-number', deal('area-sav'));

    expect(out).toEqual({ callerId: '+19125550200', source: 'area' });
  });

  it("ignores a pick the workspace does not own", async () => {
    const { resolver } = makeResolver({ twilioCallerId: '+15555550000' });

    const out = await resolver.forDialer('+17705559999', deal());

    expect(out).toEqual({ callerId: '+15555550000', source: 'default' });
  });

  it('falls through to the market when there is no pick', async () => {
    const { resolver } = makeResolver({ areaCallerId: '+19125550200' });

    const out = await resolver.forDialer(undefined, deal('area-sav'));

    expect(out).toEqual({ callerId: '+19125550200', source: 'area' });
  });

  it('works with no job in scope at all — the plain dialer', async () => {
    const { resolver } = makeResolver({ twilioCallerId: '+15555550000' });

    const out = await resolver.forDialer(undefined, undefined);

    expect(out).toEqual({ callerId: '+15555550000', source: 'default' });
  });
});

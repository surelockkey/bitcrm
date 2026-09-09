import { maskCall, maskCalls } from '../../src/calls/call-masking';
import { type EnrichedCall } from '../../src/calls/party-resolver';

const call = (over: Partial<EnrichedCall> = {}): EnrichedCall =>
  ({
    callSid: 'CA1',
    direction: 'outbound',
    from: '+14045550100',
    to: '+14045551234',
    status: 'completed',
    startedAt: '2026-08-26T10:00:00.000Z',
    fromParty: { kind: 'user', id: 'u1', name: 'Andrii' },
    toParty: { kind: 'contact', id: 'c1', name: 'Maria Alvarez' },
    ...over,
  }) as EnrichedCall;

describe('maskCall', () => {
  it('returns the record untouched for a granted viewer', () => {
    const c = call();
    expect(maskCall(c, true)).toBe(c);
  });

  it('drops both numbers for a masked viewer', () => {
    const out = maskCall(call(), false);
    expect(out.from).toBeUndefined();
    expect(out.to).toBeUndefined();
  });

  /**
   * The names are the whole point of the screen-pop and of a readable call log
   * — a masked technician still has to know they spoke to Maria Alvarez about
   * job K4T9ZW. Only the digits go.
   */
  it('keeps the resolved parties', () => {
    const out = maskCall(call(), false);
    expect(out.fromParty).toEqual({ kind: 'user', id: 'u1', name: 'Andrii' });
    expect(out.toParty).toEqual({
      kind: 'contact',
      id: 'c1',
      name: 'Maria Alvarez',
    });
  });

  it('flags which sides were masked so the UI can say "hidden"', () => {
    const out = maskCall(call(), false);
    expect(out.fromMasked).toBe(true);
    expect(out.toMasked).toBe(true);
  });

  it('does not flag a side that had no number to begin with', () => {
    const out = maskCall(call({ to: undefined }), false);
    expect(out.toMasked).toBeUndefined();
    expect(out.fromMasked).toBe(true);
  });

  it('leaves every other field intact', () => {
    const out = maskCall(call({ durationSeconds: 42 } as never), false);
    expect(out.callSid).toBe('CA1');
    expect(out.status).toBe('completed');
    expect((out as never as { durationSeconds: number }).durationSeconds).toBe(42);
  });

  it('does not mutate the input', () => {
    // Records come from cached resolvers and the SSE bus fans one object out to
    // every subscriber — masking in place would blank it for allowed viewers too.
    const c = call();
    maskCall(c, false);
    expect(c.from).toBe('+14045550100');
    expect(c.to).toBe('+14045551234');
  });

  it('masks a whole list', () => {
    const out = maskCalls([call(), call()], false);
    expect(out.every((c) => c.from === undefined && c.to === undefined)).toBe(
      true,
    );
  });

  it('returns the same list instance for a granted viewer', () => {
    const list = [call()];
    expect(maskCalls(list, true)).toBe(list);
  });

  it('tolerates an undefined record', () => {
    expect(maskCall(undefined, false)).toBeUndefined();
  });
});

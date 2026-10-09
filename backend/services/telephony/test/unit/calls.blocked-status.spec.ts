import { CallsService, isTerminalStatus, statusRank } from '../../src/calls/calls.service';
import { CallsRepository, type CallRecord } from '../../src/calls/calls.repository';
import { answerClassOf } from '../../src/calls/tracking/call-tracking';

/**
 * `blocked` is a terminal status of its own: the row a rejected inbound call
 * leaves in the log. Twilio's status callback for the rejected leg (busy /
 * no-answer / failed, depending on the reason) must not rename it, and the
 * reports must not count it as a missed call — nobody was meant to answer.
 */
describe("the 'blocked' call status", () => {
  it('is terminal, so no later webhook can move it', () => {
    expect(isTerminalStatus('blocked')).toBe(true);
    expect(statusRank('blocked')).toBe(statusRank('completed'));
  });

  it('is kept when the rejected leg reports its own status', async () => {
    const existing: CallRecord = {
      callSid: 'CAspam1',
      direction: 'inbound',
      from: '+12147917112',
      to: '+12624061115',
      status: 'blocked',
      startedAt: '2026-10-09T12:00:00.000Z',
      updatedAt: '2026-10-09T12:00:00.000Z',
      endedAt: '2026-10-09T12:00:00.000Z',
    };
    const upsert = jest.fn().mockResolvedValue(undefined);
    const repo = { upsert, getBySid: jest.fn().mockResolvedValue(existing) } as unknown as CallsRepository;
    const service = new CallsService(repo);

    await service.recordStatus({ CallSid: 'CAspam1', CallStatus: 'busy', From: '+12147917112', To: '+12624061115', Direction: 'inbound' });

    expect(upsert).not.toHaveBeenCalled();
  });

  it('is neither answered nor missed for Call Tracking and the cards', () => {
    expect(
      answerClassOf({ direction: 'inbound', status: 'blocked', startedAt: '2026-10-09T12:00:00.000Z' }),
    ).toBe('neither');
  });
});

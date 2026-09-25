import { EventEmitter } from 'events';
import { Subject } from 'rxjs';
import { DealEventsController, DEAL_STREAM_HEARTBEAT_MS } from 'src/deals/realtime/deal-events.controller';
import { type DealEvent } from 'src/deals/realtime/deal-events.bus';

function createRes() {
  return Object.assign(new EventEmitter(), {
    set: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  });
}

describe('DealEventsController.stream', () => {
  let events: Subject<DealEvent>;
  let controller: DealEventsController;

  beforeEach(() => {
    jest.useFakeTimers();
    events = new Subject<DealEvent>();
    controller = new DealEventsController({ stream: () => events.asObservable() } as never);
  });

  afterEach(() => jest.useRealTimers());

  it('opens an unbuffered event stream', () => {
    const res = createRes();

    controller.stream(res as never);

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' }),
    );
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('writes each deal event as a data frame', () => {
    const res = createRes();
    controller.stream(res as never);
    res.write.mockClear();

    const event: DealEvent = { type: 'deal.changed', dealId: 'deal-1', at: 'now' };
    events.next(event);

    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it('sends a heartbeat comment under the ALB idle timeout', () => {
    const res = createRes();
    controller.stream(res as never);
    res.write.mockClear();

    jest.advanceTimersByTime(DEAL_STREAM_HEARTBEAT_MS);

    expect(DEAL_STREAM_HEARTBEAT_MS).toBeLessThan(60_000);
    expect(res.write).toHaveBeenCalledWith(': hb\n\n');
  });

  it('stops writing once the client goes away', () => {
    const res = createRes();
    controller.stream(res as never);
    res.emit('close');
    res.write.mockClear();

    events.next({ type: 'deal.changed', dealId: 'deal-1', at: 'now' });
    jest.advanceTimersByTime(DEAL_STREAM_HEARTBEAT_MS * 2);

    expect(res.write).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });
});

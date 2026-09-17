import { HEARTBEAT_MS, MIN_SEND_INTERVAL_MS, MOVED_DISTANCE_M } from './policy';
import { createLocationSender } from './tracker';

const hartford = { lat: 41.7637, lng: -72.6851 };
const north = (metres: number) => ({
  lat: hartford.lat + metres / 111_320,
  lng: hartford.lng,
});

function sender(send: jest.Mock, clock = { now: 0 }, clear: jest.Mock = jest.fn().mockResolvedValue(undefined)) {
  return {
    clock,
    clear,
    sender: createLocationSender({ send, clear, now: () => clock.now }),
  };
}

describe('createLocationSender', () => {
  it('sends the first reading and remembers it', async () => {
    const send = jest.fn().mockResolvedValue({});
    const { sender: s, clock } = sender(send);

    expect(await s.offer(hartford)).toBe(true);
    expect(send).toHaveBeenCalledWith(hartford);

    clock.now = MIN_SEND_INTERVAL_MS - 1;
    expect(await s.offer(north(1_000))).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not let two readings cross on a slow connection', async () => {
    // The map would show the older one as current.
    let release: (() => void) | undefined;
    const send = jest.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { sender: s, clock } = sender(send);

    const first = s.offer(hartford);
    clock.now = HEARTBEAT_MS;
    expect(await s.offer(north(MOVED_DISTANCE_M * 2))).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);

    release?.();
    expect(await first).toBe(true);
  });

  it('records nothing as sent when the request failed', async () => {
    // A technician driving out of a dead spot must report immediately rather
    // than waiting out a heartbeat from a point that never left the phone.
    const send = jest.fn().mockRejectedValue(new Error('offline'));
    const { sender: s, clock } = sender(send);

    expect(await s.offer(hartford)).toBe(false);
    expect(s.lastSentAt()).toBeNull();

    send.mockResolvedValue({});
    clock.now = 1_000;
    expect(await s.offer(hartford)).toBe(true);
  });

  it('starts a new shift with a fix that always goes', async () => {
    const send = jest.fn().mockResolvedValue({});
    const { sender: s, clock } = sender(send);

    await s.offer(hartford);
    s.reset();
    clock.now = 1;

    expect(await s.offer(hartford)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('taking the pin down', () => {
  /** A request that hangs until the test lets it land. */
  const deferred = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  it('waits for a fix that is still in the air, so it cannot put the pin back', async () => {
    /*
     * The reading was taken while the technician was still on the clock but
     * lands whenever the network allows, and they can clock out in between.
     * Arriving after the delete, it writes the position back — and the server
     * keeps it with no expiry at all, so the office would see a technician
     * parked at their last job for the rest of the week.
     */
    const landed: string[] = [];
    const fix = deferred();
    const send = jest.fn().mockImplementation(async () => {
      await fix.promise;
      landed.push('fix');
    });
    const clear = jest.fn().mockImplementation(async () => {
      landed.push('clear');
    });
    const { sender: s } = sender(send, { now: 0 }, clear);

    const offered = s.offer(hartford);
    const cleared = s.clear();

    expect(clear).not.toHaveBeenCalled();
    fix.release();
    await Promise.all([offered, cleared]);

    expect(landed).toEqual(['fix', 'clear']);
  });

  it('sends no fix while the delete itself is on the wire', async () => {
    // The other order is just as wrong: a position written after the delete
    // survives, and the technician is on the map having stopped sharing.
    const gone = deferred();
    const send = jest.fn().mockResolvedValue({});
    const clear = jest.fn().mockImplementation(() => gone.promise);
    const { sender: s, clock } = sender(send, { now: 0 }, clear);

    const cleared = s.clear();
    clock.now = HEARTBEAT_MS;
    expect(await s.offer(hartford)).toBe(false);
    expect(send).not.toHaveBeenCalled();

    gone.release();
    await cleared;
  });

  it('forgets what it sent, so the next shift reports at once', async () => {
    // Otherwise the technician is missing from the map until a heartbeat five
    // minutes into the next job.
    const send = jest.fn().mockResolvedValue({});
    const { sender: s, clock } = sender(send);

    await s.offer(hartford);
    await s.clear();
    clock.now = 1;

    expect(await s.offer(hartford)).toBe(true);
    expect(s.lastSentAt()).toBe(1);
  });

  it('does not throw when the delete fails — nobody is interrupted for a pin', async () => {
    const send = jest.fn().mockResolvedValue({});
    const clear = jest.fn().mockRejectedValue(new Error('offline'));
    const { sender: s } = sender(send, { now: 0 }, clear);

    await expect(s.clear()).resolves.toBeUndefined();
  });
});

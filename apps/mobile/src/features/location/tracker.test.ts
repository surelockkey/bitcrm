import { HEARTBEAT_MS, MIN_SEND_INTERVAL_MS, MOVED_DISTANCE_M } from './policy';
import { createLocationSender } from './tracker';

const hartford = { lat: 41.7637, lng: -72.6851 };
const north = (metres: number) => ({
  lat: hartford.lat + metres / 111_320,
  lng: hartford.lng,
});

function sender(send: jest.Mock, clock = { now: 0 }) {
  return {
    clock,
    sender: createLocationSender({ send, now: () => clock.now }),
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

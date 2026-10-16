import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The softphone must hand Twilio's STUN/TURN servers (which arrive with the
 * voice token) to every call it places or answers. Without them a browser that
 * cannot reach Twilio's media servers straight over UDP gathers no candidates,
 * and the call connects in silence both ways.
 */

const ICE = [
  { urls: "stun:global.stun.twilio.com:3478" },
  { urls: "turn:global.turn.twilio.com:443?transport=tcp", username: "u", credential: "c" },
];

const mocks = vi.hoisted(() => ({
  fetchVoiceToken: vi.fn(),
  holdCall: vi.fn(),
  toastError: vi.fn(),
  devices: [] as FakeDeviceShape[],
}));

interface FakeCallShape {
  parameters: Record<string, string>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  accept: ReturnType<typeof vi.fn>;
}
interface FakeDeviceShape {
  handlers: Record<string, (...a: unknown[]) => void>;
  connect: ReturnType<typeof vi.fn>;
  updateToken: ReturnType<typeof vi.fn>;
  options: Record<string, unknown>;
  state: string;
  registrations: number;
}

function fakeCall(parameters: Record<string, string> = {}): FakeCallShape {
  const handlers: Record<string, () => void> = {};
  return {
    parameters,
    on: vi.fn((event: string, h: () => void) => {
      handlers[event] = h;
      // takeCallHere waits for media before moving the call.
      if (event === "accept") queueMicrotask(h);
    }),
    off: vi.fn(),
    accept: vi.fn(),
  };
}

vi.mock("@twilio/voice-sdk", () => {
  class Device {
    state = "unregistered";
    handlers: Record<string, (...a: unknown[]) => void> = {};
    connect = vi.fn(async () => fakeCall());
    updateToken = vi.fn();
    disconnectAll = vi.fn();
    destroy = vi.fn();
    unregister = vi.fn(async () => {});
    options: Record<string, unknown>;
    registrations = 0;
    constructor(_token: string, options: Record<string, unknown> = {}) {
      this.options = options;
      mocks.devices.push(this as unknown as FakeDeviceShape);
    }
    on(event: string, h: (...a: unknown[]) => void) {
      this.handlers[event] = h;
    }
    async register() {
      this.registrations += 1;
      this.state = "registered";
      this.handlers.registered?.();
    }
  }
  return { Device };
});
vi.mock("./api", () => ({
  fetchVoiceToken: mocks.fetchVoiceToken,
  identifyNumber: vi.fn(async () => null),
  setPresence: vi.fn(async () => {}),
  holdCall: mocks.holdCall,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/features/calls/api", () => ({
  requestTakeCall: vi.fn(async () => ({ conferenceName: "conf-CA1", previousLegs: ["CA0"] })),
  completeTakeCall: vi.fn(async () => {}),
}));
vi.mock("./tab-coordinator", () => ({ broadcast: vi.fn() }));

type Manager = typeof import("./softphone-manager");
let m: Manager;

async function freshManager(token: Record<string, unknown>) {
  vi.resetModules();
  mocks.devices.length = 0;
  mocks.fetchVoiceToken.mockReset().mockResolvedValue(token);
  m = await import("./softphone-manager");
  await m.enableSoftphone();
  return mocks.devices[0];
}

const TOKEN = { token: "jwt-1", identity: "u1", expiresAt: 1 };

describe("softphone-manager — TURN servers from the voice token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dials with the token's STUN/TURN servers", async () => {
    const device = await freshManager({ ...TOKEN, iceServers: ICE });
    await m.startCall("+12125550123");
    expect(device.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ To: "+12125550123" }),
        rtcConfiguration: { iceServers: ICE },
      }),
    );
  });

  it("places a masked call with them too", async () => {
    const device = await freshManager({ ...TOKEN, iceServers: ICE });
    await m.startBridgedCall("bridge-1", "Ann");
    expect(device.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { Bridge: "bridge-1" },
        rtcConfiguration: { iceServers: ICE },
      }),
    );
  });

  it("joins a call to supervise it with them", async () => {
    const device = await freshManager({ ...TOKEN, iceServers: ICE });
    await m.monitorCall("conf-CA1", "listen");
    expect(device.connect).toHaveBeenCalledWith(
      expect.objectContaining({ rtcConfiguration: { iceServers: ICE } }),
    );
  });

  it("takes a call over into this tab with them", async () => {
    const device = await freshManager({ ...TOKEN, iceServers: ICE });
    await m.takeCallHere("CA1");
    expect(device.connect).toHaveBeenCalledWith(
      expect.objectContaining({ rtcConfiguration: { iceServers: ICE } }),
    );
  });

  it("answers an incoming call with them", async () => {
    const device = await freshManager({ ...TOKEN, iceServers: ICE });
    const call = fakeCall({ From: "+12125550123" });
    device.handlers.incoming(call);
    await m.acceptIncoming();
    expect(call.accept).toHaveBeenCalledWith({ rtcConfiguration: { iceServers: ICE } });
  });

  it("switches to the servers of a refreshed token", async () => {
    const device = await freshManager({ ...TOKEN, iceServers: ICE });
    const fresh = [{ urls: "turn:global.turn.twilio.com:443?transport=tcp", username: "u2", credential: "c2" }];
    mocks.fetchVoiceToken.mockResolvedValue({ ...TOKEN, token: "jwt-2", iceServers: fresh });
    device.handlers.tokenWillExpire();
    await vi.waitFor(() => expect(device.updateToken).toHaveBeenCalledWith("jwt-2"));
    await m.startCall("+12125550123");
    expect(device.connect).toHaveBeenCalledWith(
      expect.objectContaining({ rtcConfiguration: { iceServers: fresh } }),
    );
  });

  it("dials exactly as before when the token brings no servers", async () => {
    const device = await freshManager(TOKEN);
    await m.startCall("+12125550123");
    expect(device.connect.mock.calls[0][0]).not.toHaveProperty("rtcConfiguration");
  });
});

describe("softphone-manager — hold", () => {
  /**
   * Hold works like Mute from the agent's side — one button, flips at once —
   * but it is the server that holds the customer's leg (and plays them the
   * company's hold music), so the flip is optimistic and undone if the server
   * says no.
   */
  beforeEach(async () => {
    vi.clearAllMocks();
    await freshManager(TOKEN);
    const { useSoftphoneStore } = await import("./softphone-store");
    useSoftphoneStore.getState().setCall("active", { direction: "outbound", number: "+12125550123" });
  });

  const held = async () => (await import("./softphone-store")).useSoftphoneStore.getState().held;

  it("holds the call the server knows, and shows it held at once", async () => {
    let finish!: () => void;
    mocks.holdCall.mockReturnValue(new Promise<void>((r) => (finish = () => r())));

    const pending = m.toggleHold("CA1");
    expect(await held()).toBe(true);
    expect(mocks.holdCall).toHaveBeenCalledWith("CA1", true);

    finish();
    await pending;
    expect(await held()).toBe(true);
  });

  it("resumes a held call", async () => {
    mocks.holdCall.mockResolvedValue({ callSid: "CA1", onHold: true });
    await m.toggleHold("CA1");
    mocks.holdCall.mockResolvedValue({ callSid: "CA1", onHold: false });

    await m.toggleHold("CA1");

    expect(mocks.holdCall).toHaveBeenLastCalledWith("CA1", false);
    expect(await held()).toBe(false);
  });

  it("puts the button back and says why when the server refuses", async () => {
    mocks.holdCall.mockRejectedValue(new Error("This call is not live"));

    await m.toggleHold("CA1");

    expect(await held()).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith("This call is not live");
  });

  it("does nothing without a call record to hold", async () => {
    await m.toggleHold(undefined);
    expect(mocks.holdCall).not.toHaveBeenCalled();
    expect(await held()).toBe(false);
  });

  it("forgets the hold when the call ends", async () => {
    mocks.holdCall.mockResolvedValue({});
    await m.toggleHold("CA1");
    const { useSoftphoneStore } = await import("./softphone-store");
    useSoftphoneStore.getState().setCall("idle", null);
    expect(await held()).toBe(false);
  });
});

/**
 * A tab left open past the token's hour said "AccessTokenExpired (20104)" and
 * the phone went dead (owner, 2026-10-16). Twilio warns only 10 s ahead by
 * default — a background tab's timers run once a minute — a failed refresh
 * was never retried, and a laptop waking from sleep finds the token already
 * gone. The phone now renews early, retries, and recovers from an expired
 * token on its own.
 */
describe("softphone-manager — the voice token never runs out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

  it("asks Twilio to warn well ahead of expiry, not 10 seconds before", async () => {
    const device = await freshManager({ ...TOKEN, expiresAt: inAnHour() });
    expect(Number(device.options.tokenRefreshMs)).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("an expired token (20104) is replaced and the phone registers again — no dead phone, no error", async () => {
    const device = await freshManager({ ...TOKEN, expiresAt: inAnHour() });
    mocks.fetchVoiceToken.mockResolvedValue({ ...TOKEN, token: "jwt-2", expiresAt: inAnHour() });
    device.state = "unregistered";

    device.handlers.error({ code: 20104, message: "AccessTokenExpired (20104)" });
    await vi.waitFor(() => expect(device.updateToken).toHaveBeenCalledWith("jwt-2"));
    await vi.waitFor(() => expect(device.registrations).toBe(2));
    const { useSoftphoneStore } = await import("./softphone-store");
    expect(useSoftphoneStore.getState().status).not.toBe("error");
  });

  it("retries a refresh that failed, instead of waiting for a warning that will not come again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const device = await freshManager({ ...TOKEN, expiresAt: inAnHour() });
    mocks.fetchVoiceToken.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ...TOKEN, token: "jwt-3", expiresAt: inAnHour() });

    device.handlers.tokenWillExpire();
    await vi.advanceTimersByTimeAsync(31_000);

    expect(device.updateToken).toHaveBeenCalledWith("jwt-3");
    vi.useRealTimers();
  });

  it("coming back to the tab with the token about to lapse renews it at once", async () => {
    const device = await freshManager({ ...TOKEN, expiresAt: Math.floor(Date.now() / 1000) + 60 });
    mocks.fetchVoiceToken.mockResolvedValue({ ...TOKEN, token: "jwt-4", expiresAt: inAnHour() });

    window.dispatchEvent(new Event("focus"));

    await vi.waitFor(() => expect(device.updateToken).toHaveBeenCalledWith("jwt-4"));
  });

  it("leaves a token with plenty of time alone when the tab comes back", async () => {
    const device = await freshManager({ ...TOKEN, expiresAt: inAnHour() });
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 20));
    expect(device.updateToken).not.toHaveBeenCalled();
  });
});

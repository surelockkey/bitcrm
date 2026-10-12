import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which microphone a call uses, and whether it is actually picking anything
 * up. Chrome hands the SDK whatever input it ranks first — on 2026-10-12 that
 * was the owner's iPhone (Continuity), busy with the very call being placed,
 * so the web side was silent and nothing in the app said so.
 */

const mocks = vi.hoisted(() => ({
  fetchVoiceToken: vi.fn(),
  devices: [] as FakeDeviceShape[],
  inputDevices: new Map<string, { deviceId: string; label: string; kind: string }>(),
}));

interface FakeCallShape {
  parameters: Record<string, string>;
  handlers: Record<string, (...a: unknown[]) => void>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  accept: ReturnType<typeof vi.fn>;
}
interface FakeAudioShape {
  availableInputDevices: Map<string, { deviceId: string; label: string; kind: string }>;
  handlers: Record<string, (...a: unknown[]) => void>;
  on: ReturnType<typeof vi.fn>;
  setInputDevice: ReturnType<typeof vi.fn>;
  unsetInputDevice: ReturnType<typeof vi.fn>;
}
interface FakeDeviceShape {
  handlers: Record<string, (...a: unknown[]) => void>;
  audio: FakeAudioShape;
  connect: ReturnType<typeof vi.fn>;
  lastCall: FakeCallShape | null;
}

function fakeCall(parameters: Record<string, string> = {}): FakeCallShape {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  return {
    parameters,
    handlers,
    on: vi.fn((event: string, h: (...a: unknown[]) => void) => {
      handlers[event] = h;
    }),
    off: vi.fn(),
    accept: vi.fn(),
  };
}

vi.mock("@twilio/voice-sdk", () => {
  class Device {
    state = "unregistered";
    handlers: Record<string, (...a: unknown[]) => void> = {};
    lastCall: FakeCallShape | null = null;
    audio: FakeAudioShape;
    connect = vi.fn(async () => {
      this.lastCall = fakeCall();
      return this.lastCall;
    });
    updateToken = vi.fn();
    disconnectAll = vi.fn();
    destroy = vi.fn();
    unregister = vi.fn(async () => {});
    constructor() {
      const handlers: Record<string, (...a: unknown[]) => void> = {};
      this.audio = {
        availableInputDevices: mocks.inputDevices,
        handlers,
        on: vi.fn((event: string, h: (...a: unknown[]) => void) => {
          handlers[event] = h;
        }),
        setInputDevice: vi.fn(async () => {}),
        unsetInputDevice: vi.fn(async () => {}),
      };
      mocks.devices.push(this as unknown as FakeDeviceShape);
    }
    on(event: string, h: (...a: unknown[]) => void) {
      this.handlers[event] = h;
    }
    async register() {
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
}));
vi.mock("@/features/calls/api", () => ({
  requestTakeCall: vi.fn(),
  completeTakeCall: vi.fn(),
}));
vi.mock("./tab-coordinator", () => ({ broadcast: vi.fn() }));

type Manager = typeof import("./softphone-manager");
type Store = typeof import("./softphone-store");
let m: Manager;
let store: Store["useSoftphoneStore"];

const MIC_MAC = { deviceId: "mic-mac", label: "MacBook Pro Microphone", kind: "audioinput" };
const MIC_PHONE = { deviceId: "mic-iphone", label: "iPhone Microphone", kind: "audioinput" };

async function freshManager(inputDeviceId: string | null = null) {
  vi.resetModules();
  mocks.devices.length = 0;
  mocks.fetchVoiceToken.mockReset().mockResolvedValue({ token: "jwt", identity: "u1", expiresAt: 1 });
  store = (await import("./softphone-store")).useSoftphoneStore;
  store.setState({ inputDeviceId, inputDevices: [], micWarning: null });
  m = await import("./softphone-manager");
  await m.enableSoftphone();
  return mocks.devices[0];
}

describe("softphone — the microphone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inputDevices.clear();
    mocks.inputDevices.set(MIC_PHONE.deviceId, MIC_PHONE);
    mocks.inputDevices.set(MIC_MAC.deviceId, MIC_MAC);
  });

  it("lists the microphones the browser offers and follows them as they come and go", async () => {
    const device = await freshManager();
    expect(store.getState().inputDevices).toEqual([
      { deviceId: "mic-iphone", label: "iPhone Microphone" },
      { deviceId: "mic-mac", label: "MacBook Pro Microphone" },
    ]);

    mocks.inputDevices.delete(MIC_PHONE.deviceId);
    device.audio.handlers.deviceChange?.([]);
    expect(store.getState().inputDevices).toEqual([
      { deviceId: "mic-mac", label: "MacBook Pro Microphone" },
    ]);
  });

  it("dials with the microphone the user picked, set before the call is placed", async () => {
    const device = await freshManager("mic-mac");
    const order: string[] = [];
    device.audio.setInputDevice.mockImplementation(async () => {
      order.push("setInputDevice");
    });
    device.connect.mockImplementation(async () => {
      order.push("connect");
      device.lastCall = fakeCall();
      return device.lastCall;
    });

    await m.startCall("+12125550123");

    expect(device.audio.setInputDevice).toHaveBeenCalledWith("mic-mac");
    expect(order).toEqual(["setInputDevice", "connect"]);
  });

  it("answers with the picked microphone too", async () => {
    const device = await freshManager("mic-mac");
    const call = fakeCall({ From: "+12125550123" });
    device.handlers.incoming(call);
    await m.acceptIncoming();
    expect(device.audio.setInputDevice).toHaveBeenCalledWith("mic-mac");
    expect(call.accept).toHaveBeenCalled();
  });

  it("lets the browser choose when the picked microphone is no longer there", async () => {
    const device = await freshManager("mic-headset-gone");
    await m.startCall("+12125550123");
    expect(device.audio.setInputDevice).not.toHaveBeenCalled();
    expect(device.connect).toHaveBeenCalled();
  });

  it("switches the microphone when the user picks another, remembering the choice", async () => {
    const device = await freshManager();
    await m.selectInputDevice("mic-mac");
    expect(device.audio.setInputDevice).toHaveBeenCalledWith("mic-mac");
    expect(store.getState().inputDeviceId).toBe("mic-mac");

    await m.selectInputDevice(null);
    expect(device.audio.unsetInputDevice).toHaveBeenCalled();
    expect(store.getState().inputDeviceId).toBeNull();
  });

  it("keeps the choice even if the SDK refuses it right now", async () => {
    const device = await freshManager();
    device.audio.setInputDevice.mockRejectedValueOnce(new Error("Device not found"));
    await m.selectInputDevice("mic-mac");
    expect(store.getState().inputDeviceId).toBe("mic-mac");
  });

  it("says so while the microphone sends only silence, and stops saying so when sound returns", async () => {
    const device = await freshManager();
    await m.startCall("+12125550123");
    const call = device.lastCall!;

    call.handlers.warning("constant-audio-input-level");
    expect(store.getState().micWarning).toMatch(/microphone/i);

    call.handlers["warning-cleared"]("constant-audio-input-level");
    expect(store.getState().micWarning).toBeNull();
  });

  it("ignores the SDK's other warnings, and forgets the silence when the call ends", async () => {
    const device = await freshManager();
    await m.startCall("+12125550123");
    const call = device.lastCall!;

    call.handlers.warning("high-jitter");
    expect(store.getState().micWarning).toBeNull();

    call.handlers.warning("constant-audio-input-level");
    call.handlers.disconnect();
    expect(store.getState().micWarning).toBeNull();
  });
});

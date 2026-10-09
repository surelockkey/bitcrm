import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ON_SCREEN_STORAGE_KEY } from "./on-screen";
import { useOnScreenStore } from "./on-screen-store";

/** A stand-in for the browser's `Notification` with a settable permission. */
function installNotification(permission: NotificationPermission, next: NotificationPermission = permission) {
  const requestPermission = vi.fn(async () => {
    fake.permission = next;
    return next;
  });
  const fake = { permission, requestPermission } as unknown as typeof Notification & { permission: NotificationPermission };
  vi.stubGlobal("Notification", fake);
  return requestPermission;
}

beforeEach(() => {
  window.localStorage.removeItem(ON_SCREEN_STORAGE_KEY);
  useOnScreenStore.setState({ enabled: false, permission: "unsupported", hydrated: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the on-screen notifications switch", () => {
  it("reads this browser's choice and permission once hydrated", () => {
    window.localStorage.setItem(ON_SCREEN_STORAGE_KEY, "1");
    installNotification("granted");
    useOnScreenStore.getState().hydrate();
    expect(useOnScreenStore.getState()).toMatchObject({ enabled: true, permission: "granted", hydrated: true });
  });

  it("asks the browser when switched on, and remembers a yes", async () => {
    const ask = installNotification("default", "granted");
    const result = await useOnScreenStore.getState().setEnabled(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(result).toBe("granted");
    expect(useOnScreenStore.getState()).toMatchObject({ enabled: true, permission: "granted" });
    expect(window.localStorage.getItem(ON_SCREEN_STORAGE_KEY)).toBe("1");
  });

  it("stays off when the browser says no, and says why", async () => {
    installNotification("default", "denied");
    const result = await useOnScreenStore.getState().setEnabled(true);
    expect(result).toBe("denied");
    expect(useOnScreenStore.getState()).toMatchObject({ enabled: false, permission: "denied" });
    expect(window.localStorage.getItem(ON_SCREEN_STORAGE_KEY)).toBe("0");
  });

  it("stays off where the browser has no notifications at all", async () => {
    vi.stubGlobal("Notification", undefined);
    const result = await useOnScreenStore.getState().setEnabled(true);
    expect(result).toBe("unsupported");
    expect(useOnScreenStore.getState().enabled).toBe(false);
  });

  it("switches off without asking anybody", async () => {
    const ask = installNotification("granted");
    useOnScreenStore.setState({ enabled: true, permission: "granted", hydrated: true });
    await useOnScreenStore.getState().setEnabled(false);
    expect(ask).not.toHaveBeenCalled();
    expect(useOnScreenStore.getState().enabled).toBe(false);
    expect(window.localStorage.getItem(ON_SCREEN_STORAGE_KEY)).toBe("0");
  });
});

import { create } from "zustand";
import { browserNotificationPermission, readOnScreenSetting, writeOnScreenSetting, type OnScreenPermission } from "./on-screen";

/*
 * The avatar menu's "On-screen notifications" switch: a per-browser choice
 * (localStorage) beside what the browser itself allows. Switching it on asks
 * the browser once (`Notification.requestPermission`); a refusal leaves it
 * off, since a switch that reads ON while nothing can show would be a lie.
 * Read off storage only once the app is up (`hydrate`), never while
 * rendering on the server.
 */
interface OnScreenState {
  enabled: boolean;
  permission: OnScreenPermission;
  hydrated: boolean;
  hydrate: () => void;
  /** Resolves with what the browser allows after the switch; `granted` is the only state that turns it on. */
  setEnabled: (enabled: boolean) => Promise<OnScreenPermission>;
}

export const useOnScreenStore = create<OnScreenState>((set) => ({
  enabled: false,
  permission: "unsupported",
  hydrated: false,

  hydrate: () => {
    const permission = browserNotificationPermission();
    set({ enabled: readOnScreenSetting() && permission === "granted", permission, hydrated: true });
  },

  setEnabled: async (enabled) => {
    if (!enabled) {
      writeOnScreenSetting(false);
      set({ enabled: false });
      return browserNotificationPermission();
    }
    let permission = browserNotificationPermission();
    if (permission === "default") {
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = "denied";
      }
    }
    const granted = permission === "granted";
    writeOnScreenSetting(granted);
    set({ enabled: granted, permission });
    return permission;
  },
}));

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * The pill beside "BitCRM Phone" — Workiz's account number. The telephony
 * config now serves it to every calls viewer (`mainNumber`); a server from
 * before that has no such field, and then the page still reads the messaging
 * default sender, as it did, for a viewer with `settings.view`.
 */
const mocks = vi.hoisted(() => ({
  config: { data: undefined as unknown, isError: false, isPending: true, fetchStatus: "fetching" as string },
  settings: { data: undefined as unknown, isError: false, isPending: true, fetchStatus: "idle" as string },
  settingsEnabled: [] as boolean[],
  canSettings: true,
}));

vi.mock("@/features/telephony/config-hooks", () => ({ useTelephonyConfig: () => mocks.config }));
vi.mock("@/features/messaging/hooks", () => ({
  useMessagingSettings: (enabled: boolean) => {
    mocks.settingsEnabled.push(enabled);
    return enabled ? mocks.settings : { data: undefined, isError: false, isPending: true, fetchStatus: "idle" };
  },
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string) => (r === "settings" ? mocks.canSettings : true), isLoading: false }),
}));

import { useMainNumber } from "./main-number";

const answered = (data: unknown) => ({ data, isError: false, isPending: false, fetchStatus: "idle" });

describe("useMainNumber", () => {
  beforeEach(() => {
    mocks.settingsEnabled.length = 0;
    mocks.canSettings = true;
    mocks.config = { data: undefined, isError: false, isPending: true, fetchStatus: "fetching" };
    mocks.settings = { data: undefined, isError: false, isPending: true, fetchStatus: "idle" };
  });

  it("reads the number from the telephony config — no settings.view needed", () => {
    mocks.canSettings = false;
    mocks.config = answered({ technicianLine: null, mainNumber: "+12034036303" });

    const { result } = renderHook(() => useMainNumber());

    expect(result.current).toEqual({ number: "+12034036303", settled: true });
    expect(mocks.settingsEnabled.every((e) => !e)).toBe(true);
  });

  it("a config that says there is none means no pill", () => {
    mocks.config = answered({ technicianLine: null, mainNumber: null });

    const { result } = renderHook(() => useMainNumber());

    expect(result.current).toEqual({ number: undefined, settled: true });
    expect(mocks.settingsEnabled.every((e) => !e)).toBe(true);
  });

  it("an older server without the field: the messaging default sender, for settings.view", () => {
    mocks.config = answered({ technicianLine: null });
    mocks.settings = answered({ defaultSenderNumber: "+12034036303" });

    const { result } = renderHook(() => useMainNumber());

    expect(result.current).toEqual({ number: "+12034036303", settled: true });
  });

  it("is not settled while the config is still on its way", () => {
    const { result } = renderHook(() => useMainNumber());

    expect(result.current.settled).toBe(false);
  });
});

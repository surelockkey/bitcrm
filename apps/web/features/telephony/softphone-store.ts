import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SoftphoneStatus =
  | "offline"
  | "connecting"
  | "online"
  | "error";

export type CallState = "idle" | "incoming" | "connecting" | "active";

export interface ActiveCall {
  direction: "inbound" | "outbound";
  /** The other party, E.164. */
  number: string;
  /** Resolved contact name (screen-pop), if any. */
  contactName?: string;
  /** Epoch ms when the call was answered (drives the timer). */
  startedAt?: number;
  /** Set when this connection is supervising another call, not a call of its own. */
  monitor?: "listen" | "join";
}

interface SoftphoneState {
  /** User intent: is the phone powered on (registered / able to receive)? */
  phoneOn: boolean;
  status: SoftphoneStatus;
  errorMessage: string | null;

  /** Is the floating dialer visible? */
  dialerOpen: boolean;
  /** Persisted widget position (top-left, px from viewport edges). */
  position: { x: number; y: number };

  callState: CallState;
  call: ActiveCall | null;
  muted: boolean;

  /** The number used as caller id for outbound calls (E.164), or null = default. */
  activeNumber: string | null;

  setPhoneOn: (on: boolean) => void;
  setActiveNumber: (num: string | null) => void;
  setStatus: (status: SoftphoneStatus, error?: string | null) => void;
  setDialerOpen: (open: boolean) => void;
  setPosition: (position: { x: number; y: number }) => void;
  setCall: (state: CallState, call: ActiveCall | null) => void;
  patchCall: (patch: Partial<ActiveCall>) => void;
  setMuted: (muted: boolean) => void;
}

export const useSoftphoneStore = create<SoftphoneState>()(
  persist(
    (set) => ({
      phoneOn: false,
      status: "offline",
      errorMessage: null,
      dialerOpen: false,
      position: { x: 24, y: 96 },
      callState: "idle",
      call: null,
      muted: false,
      activeNumber: null,

      setPhoneOn: (phoneOn) => set({ phoneOn }),
      setActiveNumber: (activeNumber) => set({ activeNumber }),
      setStatus: (status, errorMessage = null) => set({ status, errorMessage }),
      setDialerOpen: (dialerOpen) => set({ dialerOpen }),
      setPosition: (position) => set({ position }),
      setCall: (callState, call) => set({ callState, call, muted: false }),
      patchCall: (patch) =>
        set((s) => ({ call: s.call ? { ...s.call, ...patch } : s.call })),
      setMuted: (muted) => set({ muted }),
    }),
    {
      name: "bitcrm-softphone",
      // Only persist the user's preferences, never live call/connection state.
      partialize: (s) => ({
        phoneOn: s.phoneOn,
        position: s.position,
        activeNumber: s.activeNumber,
      }),
    },
  ),
);

import { create } from "zustand";

/**
 * Whether this tab currently holds the live jobs stream. The boards read it
 * to decide whether to poll: while it is up a change arrives by itself.
 */
interface DealsStreamState {
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useDealsStreamStore = create<DealsStreamState>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));

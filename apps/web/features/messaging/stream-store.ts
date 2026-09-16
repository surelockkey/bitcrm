import { create } from "zustand";

/**
 * Whether this tab currently holds a live messaging stream. Client state,
 * not server state: the counters and open-feed queries read it to decide
 * whether to poll (design §7.6 — poll counters every 30 s and the open feed
 * every 10 s when the stream is unavailable).
 */
interface MessagingStreamState {
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useMessagingStreamStore = create<MessagingStreamState>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));

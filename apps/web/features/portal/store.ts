import { create } from "zustand";

/**
 * Portal URLs are only returned when a link is (re)generated, so the ones we
 * create are remembered for this browser session (not persisted — the raw
 * token shouldn't sit in localStorage).
 */
interface PortalUrlState {
  urls: Record<string, string>;
  remember: (contactId: string, url: string) => void;
  forget: (contactId: string) => void;
}

export const usePortalUrlStore = create<PortalUrlState>((set) => ({
  urls: {},
  remember: (contactId, url) => set((s) => ({ urls: { ...s.urls, [contactId]: url } })),
  forget: (contactId) =>
    set((s) => {
      const urls = { ...s.urls };
      delete urls[contactId];
      return { urls };
    }),
}));

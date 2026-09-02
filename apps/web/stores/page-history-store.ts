import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyLabel,
  applyVisit,
  type PageVisit,
} from "@/lib/nav/page-history";

/** Last-visited pages trail, shown under the header on every page. */
interface PageHistoryState {
  visits: PageVisit[];
  /** Upgraded labels registered by detail pages, kept per path. */
  labels: Record<string, string>;
  /** Record a navigation. Label derives from the route; detail pages upgrade it via setLabel. */
  visit: (path: string) => void;
  /** Upgrade a page's label in place (e.g. "Job" → "Job (3QI2BN)") and remember it. */
  setLabel: (path: string, label: string) => void;
}

export const usePageHistoryStore = create<PageHistoryState>()(
  persist(
    (set) => ({
      visits: [],
      labels: {},
      visit: (path) =>
        set((s) => applyVisit({ visits: s.visits, labels: s.labels }, path)),
      setLabel: (path, label) =>
        set((s) =>
          applyLabel({ visits: s.visits, labels: s.labels }, path, label),
        ),
    }),
    { name: "bitcrm.page-history" },
  ),
);

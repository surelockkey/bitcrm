import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  labelForPath,
  pushVisit,
  type PageVisit,
} from "@/lib/nav/page-history";

/** Last-visited pages trail, shown under the header on every page. */
interface PageHistoryState {
  visits: PageVisit[];
  /** Record a navigation. Label derives from the route; detail pages upgrade it via setLabel. */
  visit: (path: string) => void;
  /** Replace the label of an entry in place (e.g. "Job" → "Job (3QI2BN)"). */
  setLabel: (path: string, label: string) => void;
}

export const usePageHistoryStore = create<PageHistoryState>()(
  persist(
    (set) => ({
      visits: [],
      visit: (path) =>
        set((s) => ({
          visits: pushVisit(s.visits, { path, label: labelForPath(path) }),
        })),
      setLabel: (path, label) =>
        set((s) => ({
          visits: s.visits.map((v) => (v.path === path ? { ...v, label } : v)),
        })),
    }),
    { name: "bitcrm.page-history" },
  ),
);

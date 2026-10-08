import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_VISIBLE,
  sanitizeFieldOrder,
  sanitizeVisibleFields,
  type VisibleFields,
} from "./fields";

/**
 * Which Jobs-table columns the user wants to see, and in what order.
 * Persisted per browser.
 */
interface JobFieldsState {
  visible: VisibleFields;
  /**
   * The column order USED FIELDS was dragged into in the Visible fields
   * panel. Empty until the first "Save fields": the registry order stands.
   */
  order: string[];
  /** Accepts a static field id or a `cf:<customFieldId>` column id. */
  toggle: (id: string) => void;
  /** "Save fields": the panel's whole draft at once. */
  save: (next: { visible: VisibleFields; order: string[] }) => void;
}

export const useJobFieldsStore = create<JobFieldsState>()(
  persist(
    (set) => ({
      visible: DEFAULT_VISIBLE,
      order: [],
      toggle: (id) =>
        set((s) => ({ visible: { ...s.visible, [id]: !s.visible[id] } })),
      save: ({ visible, order }) => set({ visible: { ...visible }, order: [...order] }),
    }),
    {
      name: "bitcrm.jobs-fields",
      // Stored state may predate the current column list — sanitize on load.
      merge: (persisted, current) => {
        const p = persisted as { visible?: unknown; order?: unknown } | undefined;
        return {
          ...current,
          visible: sanitizeVisibleFields(p?.visible),
          order: sanitizeFieldOrder(p?.order),
        };
      },
    },
  ),
);

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_VISIBLE,
  sanitizeVisibleFields,
  type VisibleFields,
} from "./fields";

/** Which Jobs-table columns the user wants to see. Persisted per browser. */
interface JobFieldsState {
  visible: VisibleFields;
  /** Accepts a static field id or a `cf:<customFieldId>` column id. */
  toggle: (id: string) => void;
}

export const useJobFieldsStore = create<JobFieldsState>()(
  persist(
    (set) => ({
      visible: DEFAULT_VISIBLE,
      toggle: (id) =>
        set((s) => ({ visible: { ...s.visible, [id]: !s.visible[id] } })),
    }),
    {
      name: "bitcrm.jobs-fields",
      // Stored state may predate the current column list — sanitize on load.
      merge: (persisted, current) => ({
        ...current,
        visible: sanitizeVisibleFields(
          (persisted as { visible?: unknown } | undefined)?.visible,
        ),
      }),
    },
  ),
);

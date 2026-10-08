import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_CLIENT_FIELDS, sanitizeClientFields, type ClientFieldId } from "./clients-list";

/**
 * Which Clients-grid columns the user wants, in what order — the Visible
 * fields panel's "Save fields". Per browser, like the jobs list's.
 */
interface ClientFieldsState {
  used: ClientFieldId[];
  save: (used: string[]) => void;
}

export const useClientFieldsStore = create<ClientFieldsState>()(
  persist(
    (set) => ({
      used: [...DEFAULT_CLIENT_FIELDS],
      save: (used) => set({ used: sanitizeClientFields(used) }),
    }),
    {
      name: "bitcrm.clients-fields",
      // Stored state may predate the current column list.
      merge: (persisted, current) => ({
        ...current,
        used: sanitizeClientFields((persisted as { used?: unknown } | undefined)?.used),
      }),
    },
  ),
);

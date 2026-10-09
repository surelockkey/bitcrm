import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_COMPANY_FIELDS, sanitizeCompanyFields, type CompanyFieldId } from "./companies-list";

/**
 * Which Companies-grid columns the user wants, in what order — the Visible
 * fields panel's "Save fields". Per browser, like the Clients list's.
 */
interface CompanyFieldsState {
  used: CompanyFieldId[];
  save: (used: string[]) => void;
}

export const useCompanyFieldsStore = create<CompanyFieldsState>()(
  persist(
    (set) => ({
      used: [...DEFAULT_COMPANY_FIELDS],
      save: (used) => set({ used: sanitizeCompanyFields(used) }),
    }),
    {
      name: "bitcrm.companies-fields",
      // Stored state may predate the current column list.
      merge: (persisted, current) => ({
        ...current,
        used: sanitizeCompanyFields((persisted as { used?: unknown } | undefined)?.used),
      }),
    },
  ),
);

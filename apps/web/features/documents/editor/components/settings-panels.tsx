"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { DocumentVisibility } from "@bitcrm/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobTypes } from "@/features/job-types/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { useActiveBusinessProfiles } from "@/features/business-profiles/hooks";
import { kindHasDefault } from "../../lib";
import { useEditorStore, type AutoApply } from "../store";
import { PanelSection, SwitchRow } from "./controls";

const VISIBILITY: { key: keyof DocumentVisibility; label: string; hint?: string; invoiceOnly?: boolean }[] = [
  { key: "quantity", label: "Quantity" },
  { key: "unitPrice", label: "Unit price" },
  { key: "lineAmount", label: "Line amount" },
  { key: "description", label: "Item description" },
  { key: "sku", label: "SKU" },
  { key: "taxableMark", label: "Taxable mark", hint: "A ✓ next to taxable items" },
  { key: "discount", label: "Discount" },
  { key: "tax", label: "Tax" },
  { key: "payments", label: "Payments", invoiceOnly: true },
  { key: "balance", label: "Balance due", invoiceOnly: true },
];

export function VisibilityPanel() {
  const visibility = useEditorStore((s) => s.draft?.content.visibility);
  const kind = useEditorStore((s) => s.draft?.kind);
  if (!visibility) return null;
  return (
    <PanelSection title="What can my clients see?">
      <p className="text-xs text-muted-foreground">Applies to the items list and totals on every document using this template.</p>
      <div className="space-y-3">
        {VISIBILITY.filter((v) => !v.invoiceOnly || kind !== "estimate").map((v) => (
          <SwitchRow
            key={v.key}
            label={v.label}
            hint={v.hint}
            checked={visibility[v.key]}
            onChange={(checked) => useEditorStore.getState().updateVisibility({ [v.key]: checked })}
          />
        ))}
      </div>
    </PanelSection>
  );
}

function MultiPicker({
  title,
  options,
  selected,
  loading,
  onChange,
  empty,
}: {
  title: string;
  options: { id: string; name: string }[];
  selected: string[];
  loading: boolean;
  onChange: (ids: string[]) => void;
  empty: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const set = new Set(selected);
  const unknown = selected.filter((id) => !options.some((o) => o.id === id)).length;

  return (
    <PanelSection
      title={title}
      action={
        selected.length ? (
          <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => onChange([])}>
            Clear ({selected.length})
          </button>
        ) : null
      }
    >
      {options.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label={`Search ${title.toLowerCase()}`} className="h-8 pl-7 text-xs" />
        </div>
      ) : null}
      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul role="group" aria-label={title} className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {filtered.map((o) => (
            <li key={o.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted">
                <Checkbox
                  checked={set.has(o.id)}
                  onCheckedChange={(c) => onChange(c ? [...selected, o.id] : selected.filter((id) => id !== o.id))}
                />
                <span className="truncate">{o.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {unknown ? <p className="text-[11px] text-muted-foreground">+{unknown} archived or unavailable</p> : null}
    </PanelSection>
  );
}

export function SettingsPanel() {
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const autoApply = useEditorStore((s) => s.draft?.autoApply);
  const jobTypes = useJobTypes();
  const serviceAreas = useServiceAreas();
  const companies = useActiveBusinessProfiles();
  const update = (patch: Partial<AutoApply>) => useEditorStore.getState().updateAutoApply(patch);

  if (!kindHasDefault(kind)) {
    return (
      <PanelSection title="Auto-apply">
        <p className="text-xs text-muted-foreground">Custom documents are picked by hand, so they have no auto-apply rules.</p>
      </PanelSection>
    );
  }
  if (!autoApply) return null;
  const on =
    autoApply.jobTypeIds.length + autoApply.serviceAreaIds.length + autoApply.businessProfileIds.length > 0;

  return (
    <>
      <PanelSection title="Auto-apply">
        <p className="text-xs text-muted-foreground">
          {on
            ? "Used automatically for jobs matching the selected job types, service areas and companies — the most specific match wins (unless a document picks a template)."
            : "Not auto-applied. Pick job types, service areas or companies to use this template automatically for matching jobs."}
        </p>
      </PanelSection>
      <MultiPicker
        title="Job types"
        options={(jobTypes.data ?? []).filter((j) => j.active)}
        selected={autoApply.jobTypeIds}
        loading={jobTypes.isLoading}
        onChange={(jobTypeIds) => update({ jobTypeIds })}
        empty="No job types yet."
      />
      <MultiPicker
        title="Service areas"
        options={(serviceAreas.data ?? []).filter((s) => s.active)}
        selected={autoApply.serviceAreaIds}
        loading={serviceAreas.isLoading}
        onChange={(serviceAreaIds) => update({ serviceAreaIds })}
        empty="No service areas yet."
      />
      <MultiPicker
        title="Companies"
        options={companies.active}
        selected={autoApply.businessProfileIds}
        loading={companies.isLoading}
        onChange={(businessProfileIds) => update({ businessProfileIds })}
        empty="No companies yet."
      />
    </>
  );
}

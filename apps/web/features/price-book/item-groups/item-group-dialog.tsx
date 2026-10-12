"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InventoryStatus, type ItemGroup, type Product } from "@bitcrm/types";
import { WzSelect as WzSearchSelect } from "@/components/workiz/select";
import { WzMiniToggle } from "@/components/workiz/switch-tabs";
import { WzPager } from "@/components/workiz/pager";
import { WzTrashIcon } from "@/components/workiz/icons";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { formatMoney } from "@/features/deals/lib";
import { listProducts } from "@/features/inventory/products/api";
import { useItemCategories } from "@/features/inventory/products/hooks";
import { typeLabel } from "@/features/inventory/products/lib";
import { CategoryPicker } from "@/features/inventory/item-edit/category-picker";
import {
  CategoryField,
  FloatingInput,
  WzButton,
  WzDialog,
  WzHeader,
  WzSelect,
  WzTextarea,
} from "@/features/inventory/item-edit/wz";
import { useCreateItemGroup, useUpdateItemGroup } from "./hooks";
import {
  changedGroupBody,
  draftLineFromProduct,
  draftLinesFromGroup,
  draftTotal,
  groupBodyFromDraft,
  lineAmount,
  lineMargin,
  validateGroupDraft,
  type GroupDraftErrors,
  type GroupDraftLine,
} from "./lib";

/** The API's caps. */
const NAME_MAX = 120;
const DESCRIPTION_MAX = 1000;
/** Lines a page of the popup's grid shows (Workiz pages its react-table too). */
const LINES_PER_PAGE = 5;
/** Workiz's react-table keeps four rows on screen however few lines there are. */
const MIN_ROWS = 4;
/** How long the "Add items" search waits for the typing to stop. */
const SEARCH_DEBOUNCE_MS = 250;

const GROUP_TYPES = [
  { value: "separate_items", label: "Individual items" },
  { value: "flat_rate", label: "Flat rate" },
];

/**
 * Workiz's "Create item group" / "Edit item group" (its help centre's
 * screenshots, pricebook_groups_wz_help_create / _edit_flatrate): the name,
 * "Group type", the description, "Add items" (a search of the price book),
 * "Choose category (optional)" with Browse, then the lines — Item name (the
 * type under it) · Price · Cost · Quantity · Margin · Amount · the bin —
 * with the pager under them, and "Total:" beside Cancel / Save.
 *
 * BitCRM makes Individual items groups (the type a job takes line by line),
 * so the type is shown, fixed — as Workiz greys it on Edit. Workiz's "Upload
 * Image" tile is left out (a group has no picture here). Cost and Margin are
 * money: shown and sent only with `financials.view`. The Enable switch is
 * ours (Edit only): a disabled group comes back with it, as a brand does.
 *
 * `group` undefined while loading; `null` for an id the list does not hold.
 * `initialLines` (new only) opens the popup on lines already chosen — a
 * job's items saved as a group.
 */
export function ItemGroupDialog({
  mode,
  group,
  initialLines,
  onClose,
}: {
  mode: "new" | "edit";
  group?: ItemGroup | null;
  initialLines?: GroupDraftLine[];
  onClose: () => void;
}) {
  const loading = mode === "edit" && group === undefined;
  const missing = mode === "edit" && group === null;
  const title = missing ? "Not found" : mode === "new" ? "Create item group" : "Edit item group";

  return (
    <WzDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      testId="item-group-dialog"
      className="max-h-[calc(100dvh-2rem)] w-[900px] overflow-y-auto p-6"
    >
      <WzHeader title={title} />
      {loading ? (
        <div data-testid="item-group-dialog-loading" className="space-y-6">
          <div className="h-[126px] animate-pulse rounded-[4px] bg-[#f3f6f7]" />
          <div className="h-[330px] animate-pulse rounded-[4px] bg-[#f3f6f7]" />
        </div>
      ) : missing ? (
        <>
          <p className="text-[14px] text-[#404040]">It may have been deleted.</p>
          <div className="mt-6 flex justify-end">
            <WzButton variant="secondary" onClick={onClose}>
              Close
            </WzButton>
          </div>
        </>
      ) : (
        <ItemGroupForm key={group?.id ?? "new"} group={group ?? null} initialLines={initialLines} onClose={onClose} />
      )}
    </WzDialog>
  );
}

/** The typed search, once the typing stops. */
function useDebounced(value: string, ms: number): string {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

function ItemGroupForm({
  group,
  initialLines,
  onClose,
}: {
  group: ItemGroup | null;
  initialLines?: GroupDraftLine[];
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const canSave = group ? can("products", "edit") : can("products", "create");
  const canSeeCost = can("financials", "view");
  const create = useCreateItemGroup();
  const update = useUpdateItemGroup();
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [categoryId, setCategoryId] = useState(group?.categoryId ?? "");
  const [active, setActive] = useState(group?.active ?? true);
  const [lines, setLines] = useState<GroupDraftLine[]>(() => (group ? draftLinesFromGroup(group) : (initialLines ?? [])));
  const [errors, setErrors] = useState<GroupDraftErrors | null>(null);
  const [page, setPage] = useState(1);
  const [browsing, setBrowsing] = useState(false);

  // "Add items": the price book searched on the server as the reader types.
  const [typed, setTyped] = useState("");
  const term = useDebounced(typed.trim(), SEARCH_DEBOUNCE_MS);
  const search = useQuery({
    queryKey: ["item-group-item-search", term],
    queryFn: () => listProducts({ search: term, status: InventoryStatus.ACTIVE }, undefined, 20),
    enabled: canSave && term.length > 0,
    staleTime: 30_000,
  });
  const found: Product[] = useMemo(() => search.data?.data ?? [], [search.data]);

  // The category: chosen by its full name in Workiz's Browse window, kept by id.
  const categories = useItemCategories(true);
  const byId = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  const categoryName = categoryId ? (byId.get(categoryId)?.name ?? "") : "";
  const pickable = useMemo(
    () => (categories.data ?? []).filter((c) => c.active || c.id === categoryId).map((c) => c.name),
    [categories.data, categoryId],
  );

  const pages = Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE));
  const shownPage = Math.min(page, pages);
  const shown = lines.slice((shownPage - 1) * LINES_PER_PAGE, shownPage * LINES_PER_PAGE);
  const total = draftTotal(lines);

  const setLine = (key: string, patch: Partial<GroupDraftLine>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((all) => all.filter((l) => l.key !== key));
  const addProduct = (id: string) => {
    const product = found.find((p) => p.id === id);
    if (!product) return;
    setLines((all) => {
      const next = [...all, draftLineFromProduct(product)];
      setPage(Math.ceil(next.length / LINES_PER_PAGE));
      return next;
    });
    setTyped("");
    if (errors?.items) setErrors({ ...errors, items: undefined });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problems = validateGroupDraft({ name, lines });
    setErrors(problems);
    if (problems) return;
    const body = groupBodyFromDraft({ name, description, categoryId, lines }, { canSeeCost });
    if (!group) {
      create.mutate(body, { onSuccess: onClose });
      return;
    }
    const changes = changedGroupBody(group, body);
    if (active !== (group.active !== false)) changes.active = active;
    if (Object.keys(changes).length === 0) return onClose();
    update.mutate({ id: group.id, body: changes }, { onSuccess: onClose });
  };

  const box = (line: GroupDraftLine, field: "price" | "cost" | "quantity", label: string) => {
    const error = errors?.lines[line.key]?.[field];
    return (
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error}
        value={line[field]}
        disabled={!canSave}
        onChange={(e) => setLine(line.key, { [field]: e.target.value })}
        className={cn(
          "block h-10 w-[59px] min-w-0 rounded-[4px] border border-[#ccc] bg-white px-2 text-[14px] leading-4 text-[#404040] outline-none focus:border-[#ffd400]",
          !canSave && "cursor-not-allowed bg-[#f7f7f7] text-[#999]",
          error && "border-[#f45e44] focus:border-[#f45e44]",
        )}
      />
    );
  };

  const th = "h-[42px] border-r border-[#ccc] bg-[#f7f7f7] px-2.5 text-left text-[14px] font-medium text-[#404040] last:border-r-0";
  const td = "border-r border-dotted border-[#cfcfcf] px-2.5 align-middle text-[14px] leading-4 text-[#404040] last:border-r-0";
  const blanks = Math.max(0, MIN_ROWS - shown.length);
  const columns = canSeeCost ? 7 : 5;

  return (
    <form onSubmit={submit} noValidate>
      {/* Name + Group type | the description (Workiz's Edit popup, 321px + 35px + the rest). */}
      <div className="grid grid-cols-[321px_minmax(0,1fr)] gap-x-[35px]">
        <div>
          <FloatingInput
            name="name"
            label="Item group name"
            value={name}
            onChange={(v) => {
              setName(v);
              if (errors?.name) setErrors({ ...errors, name: undefined });
            }}
            error={errors?.name}
            disabled={!canSave}
            maxLength={NAME_MAX}
          />
          <p className="mt-[22px] mb-2 text-[16px] leading-6 font-semibold text-[#3b4b52]">Group type</p>
          {/* BitCRM makes Individual items groups; the type is shown, fixed (Workiz greys it on Edit). */}
          <WzSelect
            aria-label="Group type"
            placeholder="Group type"
            value={group?.groupType ?? "separate_items"}
            options={GROUP_TYPES}
            onChange={() => undefined}
            disabled
          />
        </div>
        <WzTextarea
          name="description"
          aria-label="Item group description"
          placeholder="Item group description"
          className="h-[126px] min-h-[126px] text-[16px]"
          value={description}
          onChange={setDescription}
          disabled={!canSave}
          maxLength={DESCRIPTION_MAX}
        />
      </div>

      {/* "Add items" | "Choose category (optional)". */}
      <div className="mt-6 grid grid-cols-[478px_minmax(0,1fr)] items-center gap-x-[35px]">
        <WzSearchSelect
          label="Add items"
          options={found.map((p) => ({ value: p.id, label: p.name }))}
          value=""
          onChange={addProduct}
          onInputChange={setTyped}
          filterOption={null}
          loading={search.isFetching}
          noOptionsMessage={term ? "No items found" : "Type to search the price book"}
          disabled={!canSave}
          renderOption={(option) => {
            const p = found.find((x) => x.id === option.value);
            return (
              <span className="flex min-w-0 items-center justify-between gap-3">
                <span className="truncate">{option.label}</span>
                {p ? <span className="flex-none tabular-nums text-[#768287]">{formatMoney(p.priceClient)}</span> : null}
              </span>
            );
          }}
        />
        <CategoryField
          label="Choose category (optional)"
          value={categoryName}
          onBrowse={() => setBrowsing(true)}
          onClear={() => setCategoryId("")}
          disabled={!canSave}
        />
      </div>

      {/* The lines (Workiz's react-table in the popup). */}
      <div className="mt-4 border border-[#ddd]">
        <table className="w-full table-fixed border-separate border-spacing-0">
          <colgroup>
            <col />
            <col className="w-[100px]" />
            {canSeeCost ? <col className="w-[100px]" /> : null}
            <col className="w-[100px]" />
            {canSeeCost ? <col className="w-[88px]" /> : null}
            <col className="w-[88px]" />
            <col className="w-[60px]" />
          </colgroup>
          <thead>
            <tr>
              <th className={th}>Item name</th>
              <th className={th}>Price</th>
              {canSeeCost ? <th className={th}>Cost</th> : null}
              <th className={th}>Quantity</th>
              {canSeeCost ? <th className={th}>Margin</th> : null}
              <th className={th}>Amount</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {shown.map((line, i) => (
              <tr key={line.key} data-testid="item-group-line" className={cn("h-[70px]", i % 2 === 0 && "bg-black/[0.03]")}>
                <td className={td}>
                  <span className="block truncate" title={line.name}>
                    {line.name}
                  </span>
                  {line.type ? (
                    <span className="mt-1.5 inline-block rounded-pill bg-[#d36ff0] px-2 text-[11px] leading-[18px] font-medium tracking-[0.4px] text-white uppercase data-[service=true]:bg-[#6aa8ee]" data-service={line.type !== "product" || undefined}>
                      {typeLabel(line.type as Product["type"])}
                    </span>
                  ) : null}
                </td>
                <td className={td}>{box(line, "price", "Price")}</td>
                {canSeeCost ? <td className={td}>{box(line, "cost", "Cost")}</td> : null}
                <td className={td}>{box(line, "quantity", "Quantity")}</td>
                {canSeeCost ? (
                  <td className={td}>
                    <span className="block truncate">{lineMargin(line)}</span>
                  </td>
                ) : null}
                <td className={td}>
                  <span className="block truncate">{lineAmount(line).toFixed(2)}</span>
                </td>
                <td className={cn(td, "text-center")}>
                  {canSave ? (
                    <button
                      type="button"
                      aria-label={`Remove ${line.name}`}
                      onClick={() => removeLine(line.key)}
                      className="inline-flex text-[#f45e44] outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-[#f45e44]/40"
                    >
                      <WzTrashIcon size={21} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {Array.from({ length: blanks }, (_, i) => (
              <tr key={`blank-${i}`} aria-hidden className={cn("h-[70px]", (shown.length + i) % 2 === 0 && "bg-black/[0.03]")}>
                {Array.from({ length: columns }, (__, c) => (
                  <td key={c} className={td} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <WzPager
          className="shadow-none"
          pager={{
            page: shownPage,
            from: lines.length ? (shownPage - 1) * LINES_PER_PAGE + 1 : 1,
            to: Math.min(shownPage * LINES_PER_PAGE, lines.length),
            total: lines.length,
            totalPages: pages,
            canPrev: shownPage > 1,
            canNext: shownPage < pages,
            isFetching: false,
            prev: () => setPage(shownPage - 1),
            next: () => setPage(shownPage + 1),
          }}
        />
      </div>
      {errors?.items ? (
        <p role="alert" className="mt-1 text-[12px] leading-4 text-[#f45e44]">
          {errors.items}
        </p>
      ) : null}
      {errors && Object.keys(errors.lines).length > 0 ? (
        <p role="alert" className="mt-1 text-[12px] leading-4 text-[#f45e44]">
          Check the marked boxes: a quantity above 0, a price and cost of 0 or more.
        </p>
      ) : null}

      {group ? (
        // Ours: a disabled group comes back with it (Workiz's category switch, as the brands have).
        <div className="mt-5 flex items-center gap-[18px]">
          <WzMiniToggle label="Enable item group" checked={active} onCheckedChange={setActive} disabled={!canSave} />
          <span className="text-[14px] leading-4 font-semibold text-[#3b4b52]">Enable item group</span>
          <span className="text-[14px] leading-[21px] text-[#404040]">
            Turning this off hides the group from Add item; the jobs that have it keep its lines
          </span>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-4">
        <p data-testid="item-group-total" className="text-[18px] leading-[27px] text-[#3b4b52]">
          <span className="font-semibold">Total:</span> {formatMoney(total)}
        </p>
        <div className="flex gap-4">
          <WzButton variant="tertiary" onClick={onClose}>
            {canSave ? "Cancel" : "Close"}
          </WzButton>
          {canSave ? (
            <WzButton type="submit" loading={pending} className="min-w-[81px]">
              Save
            </WzButton>
          ) : null}
        </div>
      </div>

      {browsing ? (
        <CategoryPicker
          categories={pickable}
          value={categoryName}
          onOpenChange={setBrowsing}
          onApply={(picked) => {
            const hit = (categories.data ?? []).find((c) => c.name === picked);
            setCategoryId(hit?.id ?? "");
            setBrowsing(false);
          }}
        />
      ) : null}
    </form>
  );
}

"use client";

import { useId, useState } from "react";
import { WzMiniToggle } from "@/components/workiz/switch-tabs";
import { cn } from "@/lib/utils";
import { FloatingInput, WzButton, WzDialog, WzHeader, WzTextarea } from "@/features/inventory/item-edit/wz";
import { useCreateCatalogEntry, useUpdateCatalogEntry } from "../hooks";
import type { CatalogUpdateBody } from "../api";
import { withParentPath, type CatalogRow } from "../lib";
import type { CatalogConfig } from "./catalog-tab";

/** The API's cap on a catalog name. */
const NAME_MAX = 120;
/** The API's cap on a description. */
const DESCRIPTION_MAX = 1000;

function nameError(name: string): string | null {
  if (!name) return "Name is required";
  if (name.length > NAME_MAX) return `Must be ${NAME_MAX} characters or fewer`;
  return null;
}

/**
 * Workiz's "Create new category" / "Edit category" (616 wide,
 * pg_pricebook_wz_32_cat_edit) and "Create new brand" / "Edit brand" (488,
 * _41_brand_edit): the floating name field, the description, the Enable
 * switch with its line under it (Workiz's on categories; ours on brands, as
 * a disabled brand comes back with it), Cancel and the yellow Save.
 *
 * Workiz's picture tile and "Choose parent category" are left out: the API
 * takes neither. A sub-category's name is edited as its own name; its
 * parents stay in front of it.
 *
 * `entry` undefined while the catalog loads; `null` for an id it doesn't hold.
 */
export function CatalogDialog({
  config,
  mode,
  entry,
  canSave,
  onClose,
}: {
  config: CatalogConfig;
  mode: "new" | "edit";
  entry?: CatalogRow | null;
  /** The caller's create (new) or edit (edit) permission. */
  canSave: boolean;
  onClose: () => void;
}) {
  const categories = config.kind === "categories";
  const loading = mode === "edit" && entry === undefined;
  const missing = mode === "edit" && entry === null;
  const title = missing ? "Not found" : mode === "new" ? config.titles.create : config.titles.edit;

  return (
    <WzDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      testId="catalog-dialog"
      className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto p-6", categories ? "w-[616px]" : "w-[488px]")}
    >
      <WzHeader title={title} className={categories ? "mb-11" : "mb-6"} />
      {loading ? (
        <div data-testid="catalog-dialog-loading" className="space-y-[23px]">
          <div className="h-12 animate-pulse rounded-[4px] bg-[#f3f6f7]" />
          <div className="h-24 animate-pulse rounded-[4px] bg-[#f3f6f7]" />
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
        <CatalogForm key={entry?.id ?? "new"} config={config} entry={entry ?? null} canSave={canSave} onClose={onClose} />
      )}
    </WzDialog>
  );
}

function CatalogForm({
  config,
  entry,
  canSave,
  onClose,
}: {
  config: CatalogConfig;
  entry: CatalogRow | null;
  canSave: boolean;
  onClose: () => void;
}) {
  const categories = config.kind === "categories";
  const create = useCreateCatalogEntry(config.kind);
  const update = useUpdateCatalogEntry(config.kind);
  const pending = create.isPending || update.isPending;
  const descriptionId = useId();

  const [name, setName] = useState(entry?.name ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [active, setActive] = useState(entry?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const own = name.trim();
    const problem = nameError(own);
    if (problem) return setError(problem);
    setError(null);
    const text = description.trim();

    if (entry === null) {
      create.mutate({ name: own, active, ...(text && { description: text }) }, { onSuccess: onClose });
      return;
    }
    // Only what changed: a PUT with the old name would re-run the uniqueness check for nothing.
    const body: CatalogUpdateBody = {};
    if (own !== entry.name) body.name = withParentPath(entry.parentPath, own);
    if (text !== entry.description) body.description = text;
    if (active !== entry.active) body.active = active;
    if (Object.keys(body).length === 0) return onClose();
    update.mutate({ id: entry.id, body }, { onSuccess: onClose });
  };

  return (
    <form onSubmit={submit} noValidate>
      <FloatingInput
        name="name"
        label={config.nameLabel}
        value={name}
        onChange={(v) => {
          setName(v);
          if (error) setError(null);
        }}
        error={error ?? undefined}
        disabled={!canSave}
        maxLength={NAME_MAX}
        // Workiz's brand popup draws its fields in #9ea6aa with 5px corners; the category one in #ccc.
        inputClassName={categories ? undefined : "rounded-[5px] border-[#9ea6aa]"}
      />

      <div className={categories ? "mt-[23px]" : "mt-[26px]"}>
        {categories ? (
          <WzTextarea
            name="description"
            aria-label="Category description (optional)"
            placeholder="Category description (optional)"
            className="h-24 min-h-24"
            value={description}
            onChange={setDescription}
            disabled={!canSave}
            maxLength={DESCRIPTION_MAX}
          />
        ) : (
          // Workiz's brand Description: the floating label rides the box's top edge.
          <div className="relative">
            <textarea
              id={descriptionId}
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canSave}
              maxLength={DESCRIPTION_MAX}
              className={cn(
                "block h-[132px] w-full resize-y rounded-[5px] border border-[#9ea6aa] bg-white px-2.5 pt-5 pb-2.5 text-[14px] leading-[18.2px] break-words text-[#666] outline-none focus:border-[#ffd400]",
                !canSave && "cursor-not-allowed bg-[#f7f7f7] text-[#999]",
              )}
            />
            <label
              htmlFor={descriptionId}
              className="pointer-events-none absolute top-[2px] left-[10.4px] text-[12px] leading-5 tracking-[0.4px] text-[#8c8c8c]"
            >
              Description
            </label>
          </div>
        )}
      </div>

      {/* Workiz's Toggle-module switch, the words 50px in, the line under them. */}
      <div className="mt-[15px]">
        <div className="flex items-center gap-[18px]">
          <WzMiniToggle label={config.enableLabel} checked={active} onCheckedChange={setActive} disabled={!canSave} />
          <span className="text-[14px] leading-4 font-semibold text-foreground">{config.enableLabel}</span>
        </div>
        <p className="pt-[5px] pl-[50px] text-[14px] leading-[21px] text-foreground">{config.enableHint}</p>
      </div>

      <div className="mt-5 flex justify-end gap-4">
        <WzButton variant="tertiary" onClick={onClose}>
          {canSave ? "Cancel" : "Close"}
        </WzButton>
        {canSave ? (
          <WzButton type="submit" loading={pending} className="min-w-[81px]">
            Save
          </WzButton>
        ) : null}
      </div>
    </form>
  );
}

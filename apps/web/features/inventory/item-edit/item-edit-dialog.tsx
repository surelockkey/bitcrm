"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  useBrands,
  useItemCategories,
  useProduct,
  useProductPhoto,
} from "@/features/inventory/products/hooks";
import { useItemAttributes } from "@/features/inventory/item-attributes/hooks";
import { CustomFields } from "@/features/inventory/item-attributes/components/custom-fields";
import { cn } from "@/lib/utils";
import {
  displayCategory,
  newItemValues,
  toCreateBody,
  toUpdateBody,
  validateItem,
  valuesFromProduct,
  type ItemFormErrors,
  type ItemFormValues,
  type ItemVariant,
} from "./item-form";
import { CategoryPicker } from "./category-picker";
import { PhotoField, type PhotoChange } from "./photo-field";
import { SKU_TAKEN, isSkuTaken, useDeleteItem, useSaveItem } from "./use-save-item";
import {
  CategoryField,
  FloatingInput,
  ToggleRow,
  WzButton,
  WzConfirm,
  WzDialog,
  WzFooter,
  WzHeader,
  WzSelect,
  WzTextarea,
  type WzOption,
} from "./wz";

export type { ItemVariant } from "./item-form";

const TITLES: Record<ItemVariant, { edit: string; create: string }> = {
  inventory: { edit: "Edit Inventory item", create: "Add Inventory item" },
  "price-book": { edit: "Edit Item", create: "Add New Item" },
};

const TYPE_OPTIONS: WzOption[] = [
  { value: ProductType.PRODUCT, label: "Product" },
  { value: ProductType.SERVICE, label: "Service" },
];

const PRICE_BOOK_INFO =
  "When off, the item is hidden from the price book on web and mobile apps but remains in related item groups";

/** The footer's Save sits outside the scrolling form and submits it by id. */
const FORM_ID = "item-edit-form";

/**
 * Workiz's modal: 900 wide, about 71% of the window tall (715px on a 1000px
 * screen, as measured), the whole window on a phone. Scrolls down only.
 */
const MODAL_SIZE =
  "flex w-[900px] flex-col overflow-hidden h-[71.5dvh] min-h-[min(520px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] max-sm:h-[calc(100dvh-2rem)]";

/**
 * The item's Edit / New popup — Workiz "Edit Inventory item" (`inventory`)
 * or "Edit Item" (`price-book`), field for field and in Workiz's order.
 * Driven entirely by props, so a page may open it from its URL or its state.
 * `productId` null is a new item.
 */
export function ItemEditDialog({
  productId,
  open,
  onOpenChange,
  onCreated,
  variant,
}: {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (product: Product) => void;
  variant: ItemVariant;
}) {
  const close = () => onOpenChange(false);
  return (
    <WzDialog open={open} onOpenChange={onOpenChange} testId="item-edit-dialog" className={MODAL_SIZE}>
      {productId ? (
        <EditItem key={productId} id={productId} variant={variant} onClose={close} />
      ) : (
        <NewItem variant={variant} onClose={close} onCreated={onCreated} />
      )}
    </WzDialog>
  );
}

/**
 * The category and brand catalogs, each behind its own permission. Asked for
 * beside the permissions (the server guards them) so the fields fill in with
 * the rest; what is offered still follows the permissions.
 */
function useCatalogs() {
  const { can, isLoading } = usePermissions();
  const pending = !!isLoading;
  const canCategories = pending || can("product_categories", "view");
  const canBrands = pending || can("brands", "view");
  const categories = useItemCategories(canCategories);
  const brands = useBrands(canBrands);
  return {
    categories: canCategories ? (categories.data ?? []) : [],
    brands: canBrands ? (brands.data ?? []) : [],
    canCategories: !pending && can("product_categories", "view"),
    canBrands: !pending && can("brands", "view"),
  };
}

function EditItem({ id, variant, onClose }: { id: string; variant: ItemVariant; onClose: () => void }) {
  const query = useProduct(id);
  const title = TITLES[variant].edit;
  if (query.isLoading) return <LoadingItem title={title} onClose={onClose} />;
  if (query.isError || !query.data) {
    return (
      <Shell title="Item not found" footer={<WzButton variant="secondary" onClick={onClose}>Close</WzButton>}>
        <p className="text-[14px] text-[#404040]">It may have been deleted.</p>
      </Shell>
    );
  }
  return <ItemEditor mode="edit" variant={variant} product={query.data} onClose={onClose} />;
}

function NewItem({
  variant,
  onClose,
  onCreated,
}: {
  variant: ItemVariant;
  onClose: () => void;
  onCreated: (product: Product) => void;
}) {
  const { can, isLoading } = usePermissions();
  if (!isLoading && !can("products", "create")) {
    return (
      <Shell
        title={TITLES[variant].create}
        footer={<WzButton variant="secondary" onClick={onClose}>Close</WzButton>}
      >
        <p className="text-[14px] text-[#404040]">You don&apos;t have permission to create items.</p>
      </Shell>
    );
  }
  return <ItemEditor mode="create" variant={variant} onClose={onClose} onCreated={onCreated} />;
}

/** The popup's frame: the scrolling body (title included, as in Workiz) and the sticky footer. */
function Shell({
  title,
  children,
  footer,
  scrollRef,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  scrollRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <>
      <div
        ref={scrollRef}
        data-testid="item-edit-scroll"
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pt-6"
      >
        <WzHeader title={title} />
        {children}
      </div>
      <WzFooter>{footer}</WzFooter>
    </>
  );
}

function LoadingItem({ title, onClose }: { title: string; onClose: () => void }) {
  const block = "animate-pulse rounded-[4px] bg-[#f3f6f7]";
  return (
    <Shell
      title={title}
      footer={
        <>
          <WzButton variant="secondary" onClick={onClose}>
            Cancel
          </WzButton>
          <WzButton disabled>Save</WzButton>
        </>
      }
    >
      <div data-testid="item-edit-loading" className={COLUMNS}>
        <div className="min-w-0">
          <div className="flex gap-6">
            <div className={cn(block, "size-[113px] flex-none")} />
            <div className="min-w-0 flex-1 space-y-4">
              <div className={cn(block, "h-12")} />
              <div className={cn(block, "h-[49px]")} />
            </div>
          </div>
          <div className={cn(block, "mt-8 h-10")} />
          <div className={cn(block, "mt-6 h-12")} />
          <div className={cn(block, "mt-6 h-12")} />
        </div>
        <div className="min-w-0 space-y-4">
          <div className={cn(block, "h-12")} />
          <div className={cn(block, "h-12")} />
          <div className={cn(block, "h-[113px]")} />
        </div>
      </div>
    </Shell>
  );
}

/**
 * Two columns as in Workiz — the left one 1fr, the right .8fr, 4% apart, 10px
 * under the title (padding: a margin would fold into the title's) — that
 * stack on a narrow screen. `minmax(0, …)` lets a long value shrink its column
 * instead of pushing the popup sideways.
 */
const COLUMNS =
  "grid min-w-0 grid-cols-1 gap-y-4 pt-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] md:gap-x-[4%] md:gap-y-0";

function ItemEditor({
  mode,
  variant,
  product,
  onClose,
  onCreated,
}: {
  mode: "create" | "edit";
  variant: ItemVariant;
  product?: Product;
  onClose: () => void;
  onCreated?: (product: Product) => void;
}) {
  const { can, isLoading } = usePermissions();
  const pending = !!isLoading;
  const canWrite = can("products", mode === "edit" ? "edit" : "create");
  // Until the permissions answer, the form stands in place, disabled.
  const readOnly = pending || !canWrite;
  const showCost = pending || can("financials", "view");
  const canManageFields = !pending && can("products", "edit");
  const canDelete = !pending && can("products", "delete");
  const catalogs = useCatalogs();
  const attributes = useItemAttributes();
  const photoQuery = useProductPhoto(product?.id ?? "", !!product?.photoKey);
  const save = useSaveItem();
  const remove = useDeleteItem();
  const scrollRef = useRef<HTMLDivElement>(null);

  // The item as it was opened: the edit is measured against it, so a refresh
  // behind the popup never turns into a change the user did not make.
  const [snapshot] = useState(product);
  const [original] = useState(() => (product ? valuesFromProduct(product) : undefined));
  const [values, setValues] = useState<ItemFormValues>(() =>
    product ? valuesFromProduct(product) : newItemValues(variant),
  );
  const [errors, setErrors] = useState<ItemFormErrors>({});
  const [photo, setPhoto] = useState<PhotoChange>({});
  const [browsing, setBrowsing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set =
    <K extends keyof ItemFormValues>(key: K) =>
    (value: ItemFormValues[K]) => {
      setValues((v) => ({ ...v, [key]: value }));
      if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
    };

  const brandOptions: WzOption[] = useMemo(
    () =>
      catalogs.brands
        .filter((b) => b.active || b.id === original?.brandId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({ value: b.id, label: b.name })),
    [catalogs.brands, original],
  );
  // "Uncategorized" is BitCRM's word for none — Workiz has no such category, so
  // it is not offered; an item in it shows the field empty.
  const categoryNames = useMemo(
    () =>
      [
        ...new Set([
          ...catalogs.categories.filter((c) => c.active).map((c) => c.name),
          ...(original?.category ? [original.category] : []),
        ]),
      ].filter((name) => displayCategory(name) !== ""),
    [catalogs.categories, original],
  );

  /** Mark the fields and bring the first into view — unless the user has moved on. */
  const showErrors = (found: ItemFormErrors) => {
    setErrors(found);
    const from = document.activeElement;
    requestAnimationFrame(() => {
      if (document.activeElement !== from) return;
      const first = scrollRef.current?.querySelector<HTMLElement>("[aria-invalid=true]");
      first?.focus();
      first?.scrollIntoView?.({ block: "center" });
    });
  };
  const onSaveError = (e: unknown) => {
    if (isSkuTaken(e)) showErrors({ sku: SKU_TAKEN });
  };

  const submit = () => {
    const money = can("financials", "view");
    const options = {
      variant,
      showCost: money,
      attributeNames: (attributes.data ?? []).map((a) => a.name),
    };
    const found = validateItem(values, { mode, original, showCost: money, variant });
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    if (mode === "create") {
      save.mutate(
        { kind: "create", body: toCreateBody(values, options), photo },
        { onSuccess: (created) => onCreated?.(created), onError: onSaveError },
      );
      return;
    }
    const body = toUpdateBody(snapshot!, values, options);
    const active =
      variant === "price-book" && values.active !== original!.active ? values.active : undefined;
    if (Object.keys(body).length === 0 && !photo.file && !photo.remove && active === undefined) {
      onClose();
      return;
    }
    save.mutate(
      { kind: "update", product: snapshot!, body, photo, active },
      { onSuccess: onClose, onError: onSaveError },
    );
  };

  const inventory = variant === "inventory";
  const isProduct = values.type === ProductType.PRODUCT;
  const title = TITLES[variant][mode];

  const photoField = (
    <PhotoField
      name={values.name}
      storedUrl={product?.photoKey ? photoQuery.data?.downloadUrl : undefined}
      loading={!!product?.photoKey && photoQuery.isLoading}
      change={photo}
      onChange={setPhoto}
      disabled={readOnly}
    />
  );
  const nameField = (
    <FloatingInput
      className="mb-4"
      name="name"
      label={inventory ? "Product name" : "Title"}
      alwaysFloat
      value={values.name}
      onChange={set("name")}
      error={errors.name}
      disabled={readOnly}
    />
  );
  const skuField = (className: string) => (
    <FloatingInput
      className={className}
      name="sku"
      label={inventory ? "SKU" : "Model #"}
      alwaysFloat={inventory}
      value={values.sku}
      onChange={set("sku")}
      error={errors.sku}
      disabled={readOnly}
    />
  );
  const categoryField = (
    <CategoryField
      label="Choose category (optional)"
      value={values.category}
      onBrowse={() => setBrowsing(true)}
      disabled={readOnly || !catalogs.canCategories}
    />
  );
  const brandSelect = (className: string) => (
    <WzSelect
      className={className}
      label={inventory ? "Select brand (optional)" : "Brand"}
      placeholder={inventory ? "Select brand (optional)" : "Brand"}
      value={values.brandId}
      options={brandOptions}
      onChange={set("brandId")}
      clearable
      disabled={readOnly || !catalogs.canBrands}
      menuClassName="max-h-[164px]"
    />
  );
  const priceField = (
    <FloatingInput
      className="mb-4"
      name="priceClient"
      label="Price"
      inputMode="decimal"
      value={values.priceClient}
      onChange={set("priceClient")}
      error={errors.priceClient}
      disabled={readOnly}
    />
  );
  const costField = (className: string) =>
    showCost ? (
      <FloatingInput
        className={className}
        name="cost"
        label={inventory ? "Cost" : "Unit Cost"}
        inputMode="decimal"
        value={values.cost}
        onChange={set("cost")}
        error={errors.cost}
        disabled={readOnly}
      />
    ) : null;

  return (
    <Shell
      title={title}
      scrollRef={scrollRef}
      footer={
        <>
          <WzButton variant="secondary" onClick={onClose}>
            Cancel
          </WzButton>
          {readOnly && !pending ? null : (
            <WzButton type="submit" form={FORM_ID} loading={save.isPending} disabled={pending}>
              Save
            </WzButton>
          )}
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        data-variant={variant}
        onSubmit={(e) => {
          e.preventDefault();
          if (!readOnly) submit();
        }}
      >
        <div data-testid="item-edit-columns" className={COLUMNS}>
          {/* Left column */}
          <div data-testid="item-edit-left" className="min-w-0">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-6">
              {photoField}
              <div className="min-w-0 flex-1">
                {nameField}
                {inventory ? brandSelect("mb-4") : skuField("mb-4")}
              </div>
            </div>
            <div className={cn("mt-4", inventory ? "mb-6" : "mb-4")}>{categoryField}</div>
            {inventory ? (
              <>
                {skuField("mb-6")}
                <FloatingInput
                  className="mb-6"
                  name="reorderLevel"
                  label="Re-order at"
                  alwaysFloat
                  inputMode="numeric"
                  value={values.reorderLevel}
                  onChange={set("reorderLevel")}
                  error={errors.reorderLevel}
                  disabled={readOnly}
                />
                <FloatingInput
                  className="mb-4"
                  name="minimumStockLevel"
                  label="Minimum at location"
                  alwaysFloat
                  inputMode="numeric"
                  value={values.minimumStockLevel}
                  onChange={set("minimumStockLevel")}
                  error={errors.minimumStockLevel}
                  disabled={readOnly}
                />
              </>
            ) : (
              <>
                <WzSelect
                  className="mb-4"
                  label="Item type"
                  placeholder="Item type"
                  value={values.type}
                  options={TYPE_OPTIONS}
                  onChange={(v) => set("type")(v as ProductType)}
                  disabled={readOnly}
                />
                {isProduct ? brandSelect("mb-4") : null}
                <div className="mb-4">
                  <WzTextarea
                    name="description"
                    aria-label="Item Description (optional)"
                    placeholder="Item Description (optional)"
                    className="min-h-[138px]"
                    value={values.description}
                    onChange={set("description")}
                    error={errors.description}
                    disabled={readOnly}
                  />
                </div>
              </>
            )}
          </div>

          {/* Right column */}
          <div data-testid="item-edit-right" className="min-w-0">
            {priceField}
            {inventory ? (
              <>
                {costField("mb-8")}
                <div className="mb-10">
                  <WzTextarea
                    name="description"
                    aria-label="Description"
                    placeholder="Description"
                    className="min-h-[113px]"
                    value={values.description}
                    onChange={set("description")}
                    error={errors.description}
                    disabled={readOnly}
                  />
                </div>
                <ToggleRow
                  label="Taxable item"
                  checked={values.taxable}
                  onChange={set("taxable")}
                  disabled={readOnly}
                />
              </>
            ) : (
              <PriceBookSwitches
                mode={mode}
                values={values}
                original={original}
                product={product}
                set={set}
                readOnly={readOnly}
                canDelete={canDelete}
                costField={costField("mb-4")}
                bookingPriceError={errors.bookingPrice}
                onDelete={() => setConfirmDelete(true)}
              />
            )}
          </div>
        </div>

        <CustomFields
          className="md:mr-[46%]"
          values={values.customAttributes}
          onChange={set("customAttributes")}
          readOnly={readOnly}
          canManage={canManageFields}
        />
      </form>

      {browsing ? (
        <CategoryPicker
          categories={categoryNames}
          value={values.category}
          onOpenChange={setBrowsing}
          onApply={(category) => {
            set("category")(displayCategory(category));
            setBrowsing(false);
          }}
        />
      ) : null}
      {product ? (
        <WzConfirm
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete Item?"
          message="The item is archived: it stays on past jobs and estimates, leaves the price book and pickers, and comes back by switching on “Enable item”."
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(product.id, {
              onSuccess: () => {
                setConfirmDelete(false);
                onClose();
              },
            })
          }
        />
      ) : null}
    </Shell>
  );
}

/**
 * Price Book's right column under the prices: Manage Inventory (products),
 * Taxable item, Enable item and Show item on price book (an existing item),
 * a rule, Add to booking items, and the red Delete Item.
 */
function PriceBookSwitches({
  mode,
  values,
  original,
  product,
  set,
  readOnly,
  canDelete,
  costField,
  bookingPriceError,
  onDelete,
}: {
  mode: "create" | "edit";
  values: ItemFormValues;
  original?: ItemFormValues;
  product?: Product;
  set: <K extends keyof ItemFormValues>(key: K) => (value: ItemFormValues[K]) => void;
  readOnly: boolean;
  canDelete: boolean;
  costField: ReactNode;
  bookingPriceError?: string;
  onDelete: () => void;
}) {
  const editing = mode === "edit";
  const isProduct = values.type === ProductType.PRODUCT;
  // Switching an item off archives it — the delete permission's job.
  const canToggleActive = !readOnly && (canDelete || !original?.active);
  return (
    <>
      {costField}
      {isProduct ? (
        <ToggleRow
          className="mb-4"
          label="Manage Inventory"
          checked={values.manageStock}
          onChange={set("manageStock")}
          disabled={readOnly}
        />
      ) : null}
      {editing && isProduct && original?.manageStock ? (
        <div data-testid="on-hand" className="mb-4 text-[14px] leading-4 text-[#404040]">
          <h5 className="mb-1 text-[13px] leading-[19px] font-semibold text-[#3b4b52]">Currently on hand</h5>
          {product?.onHand ?? 0}
        </div>
      ) : null}
      <ToggleRow
        className="mb-4"
        label="Taxable item"
        checked={values.taxable}
        onChange={set("taxable")}
        disabled={readOnly}
      />
      {editing ? (
        <>
          <ToggleRow
            className="mb-4"
            label="Enable item"
            checked={values.active}
            onChange={set("active")}
            disabled={!canToggleActive}
          />
          <ToggleRow
            className="mb-4"
            label="Show item on price book"
            info={PRICE_BOOK_INFO}
            checked={values.priceBookEnabled}
            onChange={set("priceBookEnabled")}
            disabled={readOnly || !values.active}
          />
        </>
      ) : null}
      <hr className="mb-[14px] border-0 border-t border-[#ccc]" />
      <ToggleRow
        className="mb-4"
        label="Add to booking items"
        checked={values.availableInBooking}
        onChange={set("availableInBooking")}
        disabled={readOnly}
      />
      {values.availableInBooking ? (
        <FloatingInput
          className="mb-4"
          name="bookingPrice"
          label="Booking Price"
          inputMode="decimal"
          value={values.bookingPrice}
          onChange={set("bookingPrice")}
          error={bookingPriceError}
          disabled={readOnly}
        />
      ) : null}
      {editing && canDelete && product?.status !== InventoryStatus.ARCHIVED ? (
        <button
          type="button"
          onClick={onDelete}
          className="flex w-fit items-center gap-2 pt-5 text-[#f45e44] hover:opacity-80 focus-visible:underline focus-visible:outline-none"
        >
          <Trash2 className="size-6" strokeWidth={1.4} />
          <span className="text-[13px] leading-[19px] tracking-[0.4px]">Delete Item</span>
        </button>
      ) : null}
    </>
  );
}

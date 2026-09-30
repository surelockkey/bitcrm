"use client";

import type { ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProductType } from "@bitcrm/types";
import type { Brand, ProductCategory } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import {
  createProductSchema,
  updateProductSchemaFor,
  type CreateProductValues,
  type PatchProductValues,
  type UpdateProductValues,
} from "../schemas";
import { formatMargin } from "../lib";

export type ProductFormValues = CreateProductValues & { sku?: string };

/** What an edit changed. An emptied optional field is `null`, which clears it on the server. */
export type ProductFormChanges = PatchProductValues & { sku?: string };

const EMPTY: ProductFormValues = {
  name: "",
  sku: "",
  barcode: "",
  description: "",
  category: "",
  type: ProductType.PRODUCT,
  costCompany: 0,
  costTech: 0,
  priceClient: 0,
  supplier: "",
  serialTracking: false,
  taxable: true,
  minimumStockLevel: 0,
  manageStock: true,
  brandId: "",
  reorderLevel: 0,
};

/** Radix Select can't hold "" as an item value, so "No brand" gets a word of its own. */
const NO_BRAND = "none";

export function ProductForm({
  formId,
  mode,
  defaults,
  readOnly = false,
  showCompanyCost,
  categories,
  brands,
  catalogsPending = false,
  onSubmit,
}: {
  /**
   * The form renders no buttons: it sits in a popup whose footer submits it
   * with `<Button type="submit" form={formId}>`.
   */
  formId: string;
  mode: "create" | "edit";
  defaults?: Partial<ProductFormValues>;
  readOnly?: boolean;
  showCompanyCost: boolean;
  /** The item categories catalog. Empty (none yet, or no access) ⇒ free text. */
  categories: Pick<ProductCategory, "name" | "active">[];
  /** The brands catalog. Empty ⇒ the field is not shown. */
  brands: Pick<Brand, "id" | "name" | "active">[];
  /**
   * The catalogs are still loading: Category and Brand hold their places as
   * disabled selects instead of appearing (or changing shape) when they land.
   */
  catalogsPending?: boolean;
  /**
   * `changed` carries only the fields whose value the user actually edited —
   * send that as the PUT body so an imported item with an out-of-range value
   * somewhere else in the form still saves (the API validates only the fields
   * present in the body). `values` is the whole form, as before.
   */
  onSubmit: (values: ProductFormValues, changed: ProductFormChanges) => void;
}) {
  // In edit mode the caps are waived for values the user leaves untouched —
  // imported items break them and must stay editable (see updateProductSchemaFor).
  const schema =
    mode === "create"
      ? createProductSchema
      : updateProductSchemaFor(defaults as Partial<UpdateProductValues> | undefined);
  const form = useForm<ProductFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues: { ...EMPTY, ...defaults },
  });
  const { register, control, setValue, handleSubmit, formState } = form;
  const errors = formState.errors;
  // Read during render so react-hook-form's formState proxy actually tracks it.
  const dirtyFields = formState.dirtyFields as Partial<
    Record<keyof ProductFormValues, boolean>
  >;

  const submit = (values: ProductFormValues) => {
    const changed: ProductFormChanges = {};
    for (const key of Object.keys(values) as (keyof ProductFormValues)[]) {
      if (dirtyFields[key]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (changed as any)[key] = values[key];
      }
    }
    onSubmit(values, changed);
  };

  const type = useWatch({ control, name: "type" });
  const serialTracking = useWatch({ control, name: "serialTracking" });
  const taxable = useWatch({ control, name: "taxable" });
  const manageStock = useWatch({ control, name: "manageStock" });
  const category = useWatch({ control, name: "category" });
  const brandId = useWatch({ control, name: "brandId" });
  const costCompany = Number(useWatch({ control, name: "costCompany" }) || 0);
  const costTech = Number(useWatch({ control, name: "costTech" }) || 0);
  const priceClient = Number(useWatch({ control, name: "priceClient" }) || 0);
  const isService = type === ProductType.SERVICE;

  // Archived entries leave the pickers, but an item that already has one keeps
  // seeing it — otherwise its value would render as blank.
  const categoryOptions = [
    ...new Set([
      ...categories.filter((c) => c.active).map((c) => c.name),
      ...(defaults?.category ? [defaults.category] : []),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const brandOptions = brands.filter((b) => b.active || b.id === defaults?.brandId);

  const err = (name: keyof ProductFormValues) =>
    errors[name] ? (
      <p className="text-xs text-destructive">{String(errors[name]?.message)}</p>
    ) : null;

  return (
    <form id={formId} onSubmit={handleSubmit(submit)} className="space-y-7" noValidate>
      {/* Identity */}
      <Group label="Identity">
        <Field label="Name" error={err("name")}>
          <Input className="h-10" disabled={readOnly} {...register("name")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU" error={err("sku")} hint={mode === "edit" ? "Can't be changed." : undefined}>
            {mode === "edit" ? (
              <Input className="h-10 font-mono" value={defaults?.sku ?? ""} readOnly disabled />
            ) : (
              <Input className="h-10 font-mono" disabled={readOnly} {...register("sku")} />
            )}
          </Field>
          <Field label="Barcode" error={err("barcode")}>
            <Input className="h-10 font-mono" disabled={readOnly} {...register("barcode")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {catalogsPending || categories.length > 0 ? (
            <Field label="Category" error={err("category")}>
              <Select
                value={category}
                disabled={readOnly || catalogsPending}
                onValueChange={(v) => setValue("category", v, { shouldDirty: true, shouldValidate: true })}
              >
                <SelectTrigger className="h-10 w-full" aria-label="Category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            // No catalog to pick from (none set up, or no access to it).
            <Field label="Category" error={err("category")} hint="e.g. Locks > Residential > Deadbolts">
              <Input className="h-10" disabled={readOnly} {...register("category")} />
            </Field>
          )}
          <Field label="Type">
            <Select
              value={type}
              disabled={readOnly}
              onValueChange={(v) => setValue("type", v as ProductType, { shouldDirty: true })}
            >
              <SelectTrigger className="h-10 w-full" aria-label="Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ProductType.PRODUCT}>Product</SelectItem>
                <SelectItem value={ProductType.SERVICE}>Service</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {catalogsPending || brandOptions.length > 0 ? (
          <Field label="Brand" error={err("brandId")}>
            <Select
              value={brandId || NO_BRAND}
              disabled={readOnly || catalogsPending}
              onValueChange={(v) =>
                setValue("brandId", v === NO_BRAND ? "" : v, { shouldDirty: true })
              }
            >
              <SelectTrigger className="h-10 w-full" aria-label="Brand">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BRAND}>No brand</SelectItem>
                {brandOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
      </Group>

      {/* Pricing */}
      <Group label="Pricing · USD">
        <div className={cn("grid gap-3", showCompanyCost ? "grid-cols-3" : "grid-cols-2")}>
          {showCompanyCost ? (
            <Field label="Company cost" error={err("costCompany")} hint="Management-only">
              <Input type="number" step="0.01" min="0" className="h-10 tabular-nums" disabled={readOnly} {...register("costCompany")} />
            </Field>
          ) : null}
          <Field label="Tech cost" error={err("costTech")}>
            <Input type="number" step="0.01" min="0" className="h-10 tabular-nums" disabled={readOnly} {...register("costTech")} />
          </Field>
          <Field label="Client price" error={err("priceClient")}>
            <Input type="number" step="0.01" min="0" className="h-10 tabular-nums" disabled={readOnly} {...register("priceClient")} />
          </Field>
        </div>
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-medium">Taxable</span>
            <span className="text-xs text-muted-foreground">
              New job and estimate lines for this item charge tax by default.
            </span>
          </span>
          <Switch
            checked={taxable !== false}
            disabled={readOnly}
            aria-label="Taxable"
            onCheckedChange={(c) => setValue("taxable", c, { shouldDirty: true })}
          />
        </label>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {showCompanyCost ? (
            <span>
              Company margin{" "}
              <b className="text-green-600 dark:text-green-500">{formatMargin(priceClient, costCompany)}</b>
            </span>
          ) : null}
          <span>
            Tech margin{" "}
            <b className="text-green-600 dark:text-green-500">{formatMargin(priceClient, costTech)}</b>
          </span>
        </div>
      </Group>

      {/* Inventory */}
      <Group label="Inventory">
        {!isService ? (
          <>
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium">Track stock</span>
                <span className="text-xs text-muted-foreground">
                  Manage stock: count units on hand in warehouses and vans.
                </span>
              </span>
              <Switch
                checked={manageStock !== false}
                disabled={readOnly}
                aria-label="Track stock"
                onCheckedChange={(c) => setValue("manageStock", c, { shouldDirty: true })}
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium">Serial tracking</span>
                <span className="text-xs text-muted-foreground">Track each unit by serial number.</span>
              </span>
              <Switch
                checked={!!serialTracking}
                disabled={readOnly}
                onCheckedChange={(c) => setValue("serialTracking", c, { shouldDirty: true })}
              />
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Min stock level" error={err("minimumStockLevel")}>
                <Input type="number" min="0" className="h-10 tabular-nums" disabled={readOnly} {...register("minimumStockLevel")} />
              </Field>
              <Field label="Reorder level" error={err("reorderLevel")}>
                <Input type="number" min="0" step="1" className="h-10 tabular-nums" disabled={readOnly} {...register("reorderLevel")} />
              </Field>
              <Field label="Supplier" error={err("supplier")}>
                <Input className="h-10" disabled={readOnly} {...register("supplier")} />
              </Field>
            </div>
          </>
        ) : (
          <Field label="Supplier" error={err("supplier")}>
            <Input className="h-10" disabled={readOnly} {...register("supplier")} />
          </Field>
        )}
      </Group>

      {/* Description */}
      <Group label="Description">
        <Textarea rows={3} disabled={readOnly} placeholder="Optional notes about this item" {...register("description")} />
      </Group>
    </form>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="border-b pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ?? (hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null)}
    </div>
  );
}

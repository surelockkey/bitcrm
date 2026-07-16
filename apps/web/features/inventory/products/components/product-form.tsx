"use client";

import type { ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductValues,
} from "../schemas";
import { formatMargin } from "../lib";

export type ProductFormValues = CreateProductValues & { sku?: string };

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
  minimumStockLevel: 0,
};

export function ProductForm({
  mode,
  defaults,
  readOnly = false,
  showCompanyCost,
  categories,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  defaults?: Partial<ProductFormValues>;
  readOnly?: boolean;
  showCompanyCost: boolean;
  categories: string[];
  submitting: boolean;
  submitLabel: string;
  onSubmit: (values: ProductFormValues) => void;
  onCancel: () => void;
}) {
  const schema = mode === "create" ? createProductSchema : updateProductSchema;
  const form = useForm<ProductFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues: { ...EMPTY, ...defaults },
  });
  const { register, control, setValue, handleSubmit, formState } = form;
  const errors = formState.errors;

  const type = useWatch({ control, name: "type" });
  const serialTracking = useWatch({ control, name: "serialTracking" });
  const costCompany = Number(useWatch({ control, name: "costCompany" }) || 0);
  const costTech = Number(useWatch({ control, name: "costTech" }) || 0);
  const priceClient = Number(useWatch({ control, name: "priceClient" }) || 0);
  const isService = type === ProductType.SERVICE;

  const err = (name: keyof ProductFormValues) =>
    errors[name] ? (
      <p className="text-xs text-destructive">{String(errors[name]?.message)}</p>
    ) : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-7" noValidate>
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
          <Field label="Category" error={err("category")} hint="e.g. Locks > Residential > Deadbolts">
            <Input className="h-10" list="product-categories" disabled={readOnly} {...register("category")} />
            <datalist id="product-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Type">
            <Select
              value={type}
              disabled={readOnly}
              onValueChange={(v) => setValue("type", v as ProductType)}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ProductType.PRODUCT}>Product</SelectItem>
                <SelectItem value={ProductType.SERVICE}>Service</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
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
                <span className="block text-sm font-medium">Serial tracking</span>
                <span className="text-xs text-muted-foreground">Track each unit by serial number.</span>
              </span>
              <Switch
                checked={!!serialTracking}
                disabled={readOnly}
                onCheckedChange={(c) => setValue("serialTracking", c)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min stock level" error={err("minimumStockLevel")}>
                <Input type="number" min="0" className="h-10 tabular-nums" disabled={readOnly} {...register("minimumStockLevel")} />
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
        <Textarea rows={3} disabled={readOnly} placeholder="Optional notes about this product" {...register("description")} />
      </Group>

      {!readOnly ? (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="brand" disabled={submitting} className="gap-1.5">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </div>
      ) : null}
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

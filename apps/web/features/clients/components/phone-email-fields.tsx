"use client";

import {
  useFieldArray,
  useWatch,
  type ArrayPath,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from "react-hook-form";
import { Plus, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";

/** Pulls the first human-readable message out of a react-hook-form error node. */
function firstFieldError(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const row of node) {
      const m = firstFieldError(row);
      if (m) return m;
    }
    return undefined;
  }
  const n = node as { message?: unknown; root?: { message?: unknown } };
  if (typeof n.message === "string") return n.message;
  if (n.root && typeof n.root.message === "string") return n.root.message;
  return undefined;
}

/** A repeatable list of text inputs bound to a `string[]` field (phones/emails). */
export function RepeatableInputs<T extends FieldValues>({
  form,
  name,
  label,
  placeholder,
  icon: Icon,
  markPrimary = false,
  variant = "text",
}: {
  form: UseFormReturn<T>;
  name: string;
  label: string;
  placeholder: string;
  icon: LucideIcon;
  markPrimary?: boolean;
  /** `phone` renders the shared PhoneInput so numbers format + validate identically. */
  variant?: "text" | "phone";
}) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: name as ArrayPath<T> });
  const errors = form.formState.errors as Record<string, unknown>;
  const message = firstFieldError(errors[name]);
  const add = append as unknown as (v: string) => void;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => add("")}>
          <Plus className="size-3" /> Add
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <div className="space-y-2">
          {fields.map((field, i) => (
            <div key={field.id} className="flex items-center gap-2">
              <div className="flex-1">
                {variant === "phone" ? (
                  <PhoneField form={form} name={`${name}.${i}` as Path<T>} placeholder={placeholder} />
                ) : (
                  <div className="relative">
                    <Icon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-9 pl-8"
                      placeholder={placeholder}
                      {...form.register(`${name}.${i}` as Path<T>)}
                    />
                  </div>
                )}
              </div>
              {markPrimary && i === 0 ? (
                <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                  Primary
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 flex-none text-muted-foreground"
                onClick={() => remove(i)}
                aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {message ? <p className="text-xs text-destructive">{message}</p> : null}
    </div>
  );
}

/** Binds the shared PhoneInput to a react-hook-form array slot. */
function PhoneField<T extends FieldValues>({
  form,
  name,
  placeholder,
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  placeholder: string;
}) {
  const value = (useWatch({ control: form.control, name }) as string | undefined) ?? "";
  return (
    <PhoneInput
      value={value}
      placeholder={placeholder}
      onChange={(v) => form.setValue(name, v as never, { shouldValidate: true, shouldDirty: true })}
    />
  );
}

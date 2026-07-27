"use client";

import { useFieldArray, type UseFormReturn } from "react-hook-form";
import { MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocomplete } from "@/features/deals/components/address-autocomplete";
import type { ContactFormValues } from "../schemas";

/**
 * Repeatable list of structured contact addresses. The street is a Google Places
 * autocomplete (same component deals use); picking a suggestion fills
 * city/state/zip and stores lat/lng. Unit is entered manually.
 */
export function ContactAddressFields({ form }: { form: UseFormReturn<ContactFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "addresses" });
  const errors = form.formState.errors.addresses;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-sm">
          <MapPin className="size-3.5" /> Addresses
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => append({ street: "", unit: "", city: "", state: "", zip: "" })}
        >
          <Plus className="size-3" /> Add
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground">No addresses yet.</p>
      ) : (
        <div className="space-y-3">
          {fields.map((field, i) => (
            <div key={field.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <AddressAutocomplete
                    value={form.watch(`addresses.${i}.street`) ?? ""}
                    onChange={(v) =>
                      form.setValue(`addresses.${i}.street`, v, { shouldValidate: true })
                    }
                    onSelect={(a) => {
                      form.setValue(`addresses.${i}.street`, a.street, { shouldValidate: true });
                      form.setValue(`addresses.${i}.city`, a.city, { shouldValidate: true });
                      form.setValue(`addresses.${i}.state`, a.state, { shouldValidate: true });
                      form.setValue(`addresses.${i}.zip`, a.zip, { shouldValidate: true });
                      form.setValue(`addresses.${i}.lat`, a.lat);
                      form.setValue(`addresses.${i}.lng`, a.lng);
                    }}
                    placeholder="Start typing an address…"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 flex-none"
                  onClick={() => remove(i)}
                  aria-label={`Remove address ${i + 1}`}
                >
                  <X className="size-4" />
                </Button>
              </div>

              <div className="grid grid-cols-6 gap-2">
                <Input className="col-span-2 h-9" placeholder="Unit" {...form.register(`addresses.${i}.unit`)} />
                <Input className="col-span-2 h-9" placeholder="City" {...form.register(`addresses.${i}.city`)} />
                <Input className="h-9" placeholder="State" {...form.register(`addresses.${i}.state`)} />
                <Input className="h-9" placeholder="ZIP" {...form.register(`addresses.${i}.zip`)} />
              </div>

              {errors?.[i] ? (
                <p className="text-xs text-destructive">
                  {errors[i]?.street?.message ||
                    errors[i]?.city?.message ||
                    errors[i]?.state?.message ||
                    errors[i]?.zip?.message}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

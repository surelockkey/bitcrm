"use client";

import type { Address } from "@bitcrm/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocomplete, type AddressSuggestion } from "./address-autocomplete";

export interface DealAddressValue {
  street: string;
  unit?: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
}

/**
 * The deal's own service address (kept separate from the client's). When a
 * client is attached, focusing the address field surfaces their saved addresses
 * as suggestions — click one to reuse it. A brand-new address typed here is
 * offered to be saved back to the client by the parent on submit.
 */
export function DealAddressFields({
  value,
  onChange,
  clientAddresses,
  error,
  label = "Service address",
}: {
  value: DealAddressValue;
  onChange: (a: DealAddressValue) => void;
  clientAddresses?: Address[];
  error?: string;
  label?: string;
}) {
  const set = (patch: Partial<DealAddressValue>) => onChange({ ...value, ...patch });

  const suggestions: AddressSuggestion[] | undefined = clientAddresses?.length
    ? clientAddresses.map((a, i) => ({
        id: `${a.street}-${i}`,
        label: [a.street, a.unit].filter(Boolean).join(", "),
        sublabel: [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        onPick: () => onChange({ ...a }),
      }))
    : undefined;

  return (
    <div className="space-y-2.5">
      <Label>{label}</Label>

      <AddressAutocomplete
        value={value.street}
        onChange={(v) => set({ street: v })}
        onSelect={(a) =>
          onChange({ ...value, street: a.street, city: a.city, state: a.state, zip: a.zip, lat: a.lat, lng: a.lng })
        }
        suggestions={suggestions}
      />
      {suggestions?.length ? (
        <p className="text-xs text-muted-foreground">Click the field to reuse one of the client&apos;s saved addresses.</p>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="grid grid-cols-[1fr_2fr_1fr_1fr] gap-2">
        <Input className="h-9" placeholder="Unit" value={value.unit ?? ""} onChange={(e) => set({ unit: e.target.value })} />
        <Input className="h-9" placeholder="City" value={value.city} onChange={(e) => set({ city: e.target.value })} />
        <Input className="h-9" placeholder="State" value={value.state} onChange={(e) => set({ state: e.target.value })} />
        <Input className="h-9" placeholder="ZIP" value={value.zip} onChange={(e) => set({ zip: e.target.value })} />
      </div>
    </div>
  );
}

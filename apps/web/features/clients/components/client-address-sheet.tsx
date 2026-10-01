"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Address, Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AddressAutocomplete } from "@/features/deals/components/address-autocomplete";
import { AddressMap, GetDirections } from "./address-map";
import { clientAddressRows } from "../client-page";
import { useSetContactAddresses, useSetContactBillingAddress } from "../hooks";
import { addressInList, addressKey, formatAddress } from "../lib";

const EMPTY: Address = { street: "", unit: "", city: "", state: "", zip: "" };
const NEW = "__new__";

/** What the panel is for: one more address, or which address is the service / billing one. */
export type AddressSheetMode = "new" | "service" | "billing";

/**
 * Workiz's "Address" side panel. From Create new it adds an address to the
 * client. From the pencil on the card's Service or Billing address it opens
 * on that address with "Client properties" — pick another of the client's
 * addresses to take the role, or edit the fields — and Save.
 */
export function ClientAddressSheet({
  contact,
  mode,
  open,
  onOpenChange,
}: {
  contact: Contact;
  mode: AddressSheetMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const current = mode === "service" ? contact.addresses[0] : mode === "billing" ? contact.billingAddress : undefined;
  const properties = useMemo(() => clientAddressRows(contact, []).map((r) => r.address), [contact]);
  // The page remounts the panel per opening (its `key`), so the role's
  // address of today is the starting point, with no effect to sync it.
  const [picked, setPicked] = useState<string>(() => (current ? addressKey(current) : NEW));
  const [draft, setDraft] = useState<Address>(() => (current ? { ...current } : EMPTY));
  const [error, setError] = useState<string | null>(null);
  const saveList = useSetContactAddresses(contact.id);
  const saveBilling = useSetContactBillingAddress(contact.id);
  const pending = saveList.isPending || saveBilling.isPending;

  const set = (patch: Partial<Address>) => setDraft((d) => ({ ...d, ...patch }));
  const pick = (key: string) => {
    setPicked(key);
    const found = key === NEW ? undefined : properties.find((a) => addressKey(a) === key);
    setDraft(found ? { ...found } : EMPTY);
  };

  const close = (o: boolean) => onOpenChange(o);

  const submit = () => {
    const a: Address = {
      street: draft.street.trim(),
      ...(draft.unit?.trim() && { unit: draft.unit.trim() }),
      city: draft.city.trim(),
      state: draft.state.trim(),
      zip: draft.zip.trim(),
      ...(draft.lat !== undefined && { lat: draft.lat }),
      ...(draft.lng !== undefined && { lng: draft.lng }),
    };
    if (!a.street) return setError("Street is required");
    setError(null);
    if (mode === "billing") {
      saveBilling.mutate(a, { onSuccess: () => close(false) });
      return;
    }
    if (mode === "service") {
      // The chosen (or edited) address leads; everything else keeps its
      // order; the address it was edited from and any copy of it drop out.
      const key = addressKey(a);
      const rest = contact.addresses.filter((x) => addressKey(x) !== key && addressKey(x) !== picked);
      saveList.mutate([a, ...rest], { onSuccess: () => close(false) });
      return;
    }
    if (addressInList(a, contact.addresses)) return setError("The client already has this address");
    saveList.mutate([...contact.addresses, a], { onSuccess: () => close(false) });
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-center text-base">Address</SheetTitle>
          <SheetDescription className="sr-only">
            {mode === "new" ? "A new address for" : mode === "service" ? "The service address of" : "The billing address of"} {contact.firstName} {contact.lastName}.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {/* Workiz's panel: the map first, pinned on the address being edited. */}
          <AddressMap address={draft} />
          {mode !== "new" ? (
            <div className="space-y-1.5">
              <Label>Client properties</Label>
              <Select value={picked} onValueChange={pick}>
                <SelectTrigger className="h-9 w-full" aria-label="Client properties">
                  <SelectValue placeholder="Pick one of the client's addresses" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((a) => (
                    <SelectItem key={addressKey(a)} value={addressKey(a)}>
                      {formatAddress(a)}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW}>New address…</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="client-address-street">Address</Label>
            <AddressAutocomplete
              id="client-address-street"
              ariaLabel="Address"
              value={draft.street}
              onChange={(v) => set({ street: v })}
              onSelect={(a) => set({ street: a.street, city: a.city, state: a.state, zip: a.zip, lat: a.lat, lng: a.lng })}
              placeholder="Address"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="client-address-unit">Unit</Label>
              <Input id="client-address-unit" className="h-9" value={draft.unit ?? ""} onChange={(e) => set({ unit: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-address-city">City</Label>
              <Input id="client-address-city" className="h-9" value={draft.city} onChange={(e) => set({ city: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-address-state">State</Label>
              <Input id="client-address-state" className="h-9" value={draft.state} onChange={(e) => set({ state: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-address-zip">Zip</Label>
              <Input id="client-address-zip" className="h-9" value={draft.zip} onChange={(e) => set({ zip: e.target.value })} />
            </div>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <GetDirections address={draft} />
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="button" variant="brand" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

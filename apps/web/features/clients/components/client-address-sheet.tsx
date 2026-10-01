"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { Address, Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AddressAutocomplete } from "@/features/deals/components/address-autocomplete";
import { useSetContactAddresses } from "../hooks";
import { addressInList } from "../lib";

const EMPTY: Address = { street: "", unit: "", city: "", state: "", zip: "" };

/**
 * Workiz's "Address" side panel from Create new: one more address on the
 * client. The street is the same autocomplete the job form uses; picking a
 * suggestion fills the rest. Saves onto the client's list, nothing else.
 */
export function ClientAddressSheet({
  contact,
  open,
  onOpenChange,
}: {
  contact: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState<Address>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const save = useSetContactAddresses(contact.id);
  const set = (patch: Partial<Address>) => setDraft((d) => ({ ...d, ...patch }));

  const close = (o: boolean) => {
    if (!o) {
      setDraft(EMPTY);
      setError(null);
    }
    onOpenChange(o);
  };

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
    if (addressInList(a, contact.addresses)) return setError("The client already has this address");
    setError(null);
    save.mutate([...contact.addresses, a], { onSuccess: () => close(false) });
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-center text-base">Address</SheetTitle>
          <SheetDescription className="sr-only">A new address for {contact.firstName} {contact.lastName}.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="button" variant="brand" onClick={submit} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

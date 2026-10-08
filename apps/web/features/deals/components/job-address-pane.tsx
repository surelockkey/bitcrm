"use client";

import { useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import type { Address } from "@bitcrm/types";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { WzButton, WzFieldGroup, WzSelect, WzTextField } from "@/components/workiz";
import { AddressMap } from "@/features/clients/components/address-map";
import { addressKey } from "@/features/clients/lib";
import { addressSummary } from "../job-details-form";
import { AddressAutocomplete } from "./address-autocomplete";
import { WzCountrySelect, WzStateSelect } from "./workiz";

/** Google Maps directions to the address, as the box's road-sign icon and the pane's last row. */
export function directionsHref(a: Address): string {
  return `https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=${encodeURIComponent(addressSummary(a))}`;
}

/**
 * Workiz's "Address" pane (jobdetails_wz_address_open), opened from the job's
 * one-line address box: a 400px drawer from the right with a grey header,
 * "Client properties" (the client's saved addresses), the map, Address | Unit,
 * City | State, Zip | Country, "Get directions", and Cancel / Save at the
 * foot. Save hands the address back to the form — the page's own Save writes
 * it, as with every other field.
 *
 * The street box is our Places autocomplete (`AddressAutocomplete`) for now;
 * once the New Job branch lands it can take `usePlacesAutocomplete()` and the
 * kit's floating-label box.
 */
export function JobAddressPane({
  open,
  onOpenChange,
  value,
  clientAddresses,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: Address;
  /** The client's saved addresses ("Client properties"). */
  clientAddresses?: Address[];
  onApply: (address: Address) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        // right-pane-content: 400px, white, no gaps of its own.
        className="gap-0 bg-white p-0 text-wz-strong data-[side=right]:w-[400px] data-[side=right]:max-w-full data-[side=right]:sm:max-w-[400px]"
      >
        {/* Remounted per opening, so the fields start from the job's address. */}
        {open ? (
          <PaneBody value={value} clientAddresses={clientAddresses} onApply={onApply} onClose={() => onOpenChange(false)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PaneBody({
  value,
  clientAddresses,
  onApply,
  onClose,
}: {
  value: Address;
  clientAddresses?: Address[];
  onApply: (address: Address) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Address>(() => ({ ...value }));
  const set = (patch: Partial<Address>) => setDraft((d) => ({ ...d, ...patch }));

  const properties = useMemo(() => {
    const seen = new Set<string>();
    return (clientAddresses ?? []).filter((a) => {
      const k = addressKey(a);
      if (!a.street?.trim() || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [clientAddresses]);
  const options = properties.map((a) => ({ value: addressKey(a), label: addressSummary(a) }));
  const picked = options.some((o) => o.value === addressKey(draft)) ? addressKey(draft) : "";

  return (
    <>
      {/* The grey 49px head: "Address" centred, 18px/600, the × at the right. */}
      <div className="relative flex h-[49px] shrink-0 items-center justify-center rounded-[3px] border border-[#eeeeee] bg-[#f7f7f7]">
        <SheetTitle className="font-sans text-[18px] leading-[19px] font-semibold text-[#3b4c53]">Address</SheetTitle>
        <SheetDescription className="sr-only">The job&apos;s service address.</SheetDescription>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-[14px] right-[15px] grid size-5 place-items-center text-[#607890]"
        >
          <X className="size-[18px]" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5">
        {properties.length ? (
          <div className="mb-2.5">
            <h5 className="mt-2 mb-2.5 text-[14px] leading-4 font-semibold text-foreground">Client properties</h5>
            <WzSelect
              label="Client properties"
              options={options}
              value={picked}
              searchable={false}
              onChange={(key) => {
                const found = properties.find((a) => addressKey(a) === key);
                if (found) setDraft({ ...found });
              }}
              // Workiz's select here has no floating label: just the value, centred.
              className="[&>label]:sr-only [&_[data-slot=wz-select-value]]:top-[15.32px]"
            />
          </div>
        ) : null}

        {/* addressPane-module__map: the address pinned, min 200px, 6px corners. */}
        <div className="mt-2.5 mb-5 [&>div]:h-[200px] [&>div]:rounded-[6px]">
          <AddressMap address={draft} />
        </div>

        <WzFieldGroup join="seamless" className="mb-2.5">
          <div className="min-w-0 flex-1" data-slot="wz-address-street">
            <AddressAutocomplete
              value={draft.street}
              ariaLabel="Address"
              placeholder="Address"
              onChange={(street) => set({ street })}
              onSelect={(a) => set({ street: a.street, city: a.city, state: a.state, zip: a.zip, lat: a.lat, lng: a.lng })}
              className="h-12 rounded-[2px] border-input text-[16px] text-wz-text shadow-none focus-visible:border-wz-focus focus-visible:ring-0"
            />
          </div>
          <WzTextField label="Unit" className="w-[151px] flex-none" value={draft.unit ?? ""} onChange={(e) => set({ unit: e.target.value })} />
        </WzFieldGroup>

        <div className="mb-2.5 flex gap-5">
          <WzTextField label="City" className="flex-1" overhang={false} value={draft.city} onChange={(e) => set({ city: e.target.value })} />
          <WzStateSelect
            className="flex-1"
            country={draft.country}
            value={draft.state}
            onChange={(state) => set({ state })}
          />
        </div>

        <div className="mb-2.5 flex gap-5">
          <WzTextField label="Zip" className="flex-1" overhang={false} value={draft.zip} onChange={(e) => set({ zip: e.target.value })} />
          <WzCountrySelect className="flex-1" value={draft.country} onChange={(country) => set({ country })} />
        </div>

        {draft.street.trim() || draft.city.trim() ? (
          <a
            href={directionsHref(draft)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between border-b border-foreground py-5 text-[14px] leading-4 text-foreground"
          >
            <span>Get directions</span>
            <ChevronRight className="size-5" strokeWidth={1.5} aria-hidden />
          </a>
        ) : null}
      </div>

      {/* _paneButtons: 15px 20px, a soft shadow above, two pills sharing the row. */}
      <div className="flex shrink-0 gap-4 bg-white px-5 py-[15px] shadow-[0_0_5px_rgba(50,50,50,0.2)]">
        <WzButton variant="secondary" size="regular" className="flex-1" onClick={onClose}>
          Cancel
        </WzButton>
        <WzButton
          size="regular"
          className="flex-1"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Save
        </WzButton>
      </div>
    </>
  );
}

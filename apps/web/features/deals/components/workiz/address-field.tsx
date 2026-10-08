"use client";

import { useId, useState } from "react";
import type { Address } from "@bitcrm/types";
import { WzSuggestion, WzSuggestionList, WzTextField } from "@/components/workiz";
import { MapsProvider } from "@/components/maps/maps-provider";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";
import type { PlacePrediction } from "@/lib/google-maps";
import { usePlacesAutocomplete, type ParsedAddress } from "../address-autocomplete";

export interface WzAddressFieldProps {
  /** The street line. */
  value: string;
  onChange: (street: string) => void;
  /** A Google address or a saved one was chosen: the whole address. */
  onSelect: (address: ParsedAddress & { unit?: string }) => void;
  /** The client's saved addresses, offered while the box is (nearly) empty. */
  saved?: Address[];
  /** ISO code of the Country select — Google only suggests addresses there. */
  country?: string;
  error?: string;
  className?: string;
}

/**
 * Workiz's "Address" box (the left of "Address | Unit"): a floating-label
 * field whose suggestions hang under it in Workiz's suggestion rows — the
 * client's saved addresses while it is nearly empty, then Google's. Without
 * a Maps key it is a plain box that still offers the saved addresses.
 */
export function WzAddressField(props: WzAddressFieldProps) {
  if (!env.googleMapsApiKey) return <AddressBox {...props} places={null} />;
  return (
    <MapsProvider>
      <PlacesAddressBox {...props} />
    </MapsProvider>
  );
}

function PlacesAddressBox(props: WzAddressFieldProps) {
  const places = usePlacesAutocomplete((props.country || "US").toLowerCase());
  return <AddressBox {...props} places={places} />;
}

type Places = ReturnType<typeof usePlacesAutocomplete> | null;

interface Row {
  key: string;
  title: string;
  subtitle?: string;
  pick: () => void;
}

function AddressBox({
  value,
  onChange,
  onSelect,
  saved,
  error,
  className,
  places,
}: WzAddressFieldProps & { places: Places }) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);

  const nearlyEmpty = value.trim().length < 3;
  const savedRows: Row[] =
    nearlyEmpty && saved?.length
      ? saved.map((a, i) => ({
          key: `saved-${i}`,
          title: [a.street, a.unit].filter(Boolean).join(", "),
          subtitle: [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
          pick: () =>
            onSelect({
              street: a.street,
              unit: a.unit,
              city: a.city,
              state: a.state,
              zip: a.zip,
              country: a.country,
              lat: a.lat,
              lng: a.lng,
            }),
        }))
      : [];
  const googleRows: Row[] = nearlyEmpty
    ? []
    : (places?.predictions ?? []).map((p: PlacePrediction) => ({
        key: p.place_id,
        title: p.structured_formatting?.main_text ?? p.description,
        subtitle: p.structured_formatting?.secondary_text,
        pick: () => {
          onChange(p.structured_formatting?.main_text ?? p.description);
          places?.details(p, (addr) => onSelect(addr));
        },
      }));
  const rows = [...savedRows, ...googleRows];
  const open = focused && rows.length > 0;

  const choose = (row: Row) => {
    row.pick();
    setActive(-1);
    setFocused(false);
  };

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <WzTextField
        label="Address"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        value={value}
        error={error}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          places?.request(e.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % rows.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? rows.length - 1 : a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            choose(rows[active]);
          } else if (e.key === "Escape") {
            setFocused(false);
          }
        }}
      />
      {open ? (
        <WzSuggestionList id={listId} className="top-12">
          {rows.map((r, i) => (
            <WzSuggestion
              key={r.key}
              title={r.title}
              subtitle={r.subtitle}
              query={nearlyEmpty ? "" : value}
              active={i === active}
              onSelect={() => choose(r)}
            />
          ))}
          {googleRows.length ? (
            <div className="px-2.5 py-1 text-right text-[10px] leading-4 text-wz-caption">Powered by Google</div>
          ) : null}
        </WzSuggestionList>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { Loader2, MapPin } from "lucide-react";
import type { Address } from "@bitcrm/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { env } from "@/lib/env";
import { parsePlace, type PlaceAddressComponent } from "@/lib/geo/parse-place";

interface Props {
  value: string;
  onChange: (street: string) => void;
  /** Fired when a real place is picked — carries the coordinates with it. */
  onSelect: (address: Address) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Street input that suggests real places and, on pick, yields a full address
 * *with coordinates*.
 *
 * This is where a deal's location is born. Typed-by-hand addresses have to be
 * geocoded server-side and may not resolve at all; a picked place is exact and
 * lands on the dispatch map immediately.
 *
 * Without a Maps key it degrades to an ordinary text field — the form still works,
 * the deal is just geocoded later by the backend.
 */
export function AddressAutocomplete(props: Props) {
  if (!env.googleMapsApiKey) return <PlainStreetInput {...props} />;
  return <PlacesStreetInput {...props} />;
}

function PlainStreetInput({ value, onChange, placeholder, className }: Props) {
  return (
    <Input
      className={className}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

interface Suggestion {
  id: string;
  text: string;
  toAddress: () => Promise<Address | null>;
}

const MIN_QUERY = 3;
const DEBOUNCE_MS = 250;

function PlacesStreetInput({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
}: Props) {
  const places = useMapsLibrary("places");
  const listId = useId();

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // A session token groups keystrokes + the final pick into one billable event.
  const sessionToken = useRef<unknown>(null);
  // Set while we apply a pick, so the resulting value change doesn't re-query.
  const applying = useRef(false);

  useEffect(() => {
    if (!places || applying.current || value.trim().length < MIN_QUERY) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const lib = places as unknown as {
          AutocompleteSessionToken: new () => unknown;
          AutocompleteSuggestion: {
            fetchAutocompleteSuggestions: (request: unknown) => Promise<{
              suggestions: Array<{
                placePrediction: {
                  placeId: string;
                  text: { toString: () => string };
                  toPlace: () => {
                    fetchFields: (request: unknown) => Promise<unknown>;
                    addressComponents?: PlaceAddressComponent[];
                    location?: { lat: () => number; lng: () => number };
                  };
                };
              }>;
            }>;
          };
        };

        sessionToken.current ??= new lib.AutocompleteSessionToken();

        const { suggestions: found } =
          await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: value,
            sessionToken: sessionToken.current,
            includedRegionCodes: ["us"],
          });

        if (cancelled) return;

        setSuggestions(
          found.map((s) => ({
            id: s.placePrediction.placeId,
            text: s.placePrediction.text.toString(),
            toAddress: async () => {
              const place = s.placePrediction.toPlace();
              await place.fetchFields({
                fields: ["addressComponents", "location"],
              });
              // The token is spent once a place is fetched.
              sessionToken.current = null;

              const location = place.location;
              if (!location || !place.addressComponents) return null;

              return parsePlace(place.addressComponents, {
                lat: location.lat(),
                lng: location.lng(),
              });
            },
          })),
        );
        setOpen(true);
      } catch {
        // A failed lookup must not block typing — the address can still be
        // entered by hand and geocoded server-side.
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [places, value]);

  const pick = async (suggestion: Suggestion) => {
    applying.current = true;
    setOpen(false);
    setSuggestions([]);

    const address = await suggestion.toAddress();
    if (address) onSelect(address);

    // Let the value settle before re-enabling lookups.
    setTimeout(() => {
      applying.current = false;
    }, 0);
  };

  return (
    <div className="relative">
      <Input
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
      />

      {busy ? (
        <Loader2 className="absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : null}

      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                // Fires before the input's blur, which would otherwise close the list.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(suggestion)}
                className={cn(
                  "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm",
                  "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span>{suggestion.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

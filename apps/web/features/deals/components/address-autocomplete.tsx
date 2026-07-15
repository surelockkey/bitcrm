"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  loadGoogleMaps,
  parsePlace,
  type PlacePrediction,
} from "@/lib/google-maps";

export interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
}

/**
 * Street-address input backed by Google Places autocomplete, rendered with our
 * own dropdown (not the default Google widget). Falls back to a plain input
 * when no API key is configured. On selecting a suggestion, `onSelect` fires
 * with the parsed street/city/state/zip so the caller can fill the rest.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Start typing an address…",
  country = "us",
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (addr: ParsedAddress) => void;
  placeholder?: string;
  country?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const serviceRef = useRef<InstanceType<NonNullable<Window["google"]>["maps"]["places"]["AutocompleteService"]> | null>(null);
  const placesRef = useRef<InstanceType<NonNullable<Window["google"]>["maps"]["places"]["PlacesService"]> | null>(null);
  const sessionRef = useRef<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    loadGoogleMaps().then((g) => {
      if (!alive || !g) return;
      serviceRef.current = new g.maps.places.AutocompleteService();
      placesRef.current = new g.maps.places.PlacesService(document.createElement("div"));
      sessionRef.current = new g.maps.places.AutocompleteSessionToken();
      setReady(true);
    });
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const query = (input: string) => {
    if (!serviceRef.current || input.trim().length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    serviceRef.current.getPlacePredictions(
      {
        input,
        types: ["address"],
        componentRestrictions: country ? { country } : undefined,
        sessionToken: sessionRef.current,
      },
      (preds) => {
        setLoading(false);
        setPredictions(preds ?? []);
        setActive(0);
        setOpen((preds ?? []).length > 0);
      },
    );
  };

  const handleChange = (v: string) => {
    onChange(v);
    if (!ready) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => query(v), 220);
  };

  const choose = (pred: PlacePrediction) => {
    setOpen(false);
    setPredictions([]);
    onChange(pred.structured_formatting?.main_text ?? pred.description);
    const places = placesRef.current;
    const g = window.google;
    if (!places || !g) return;
    places.getDetails(
      { placeId: pred.place_id, fields: ["address_components", "geometry"], sessionToken: sessionRef.current },
      (place, status) => {
        // Start a fresh billing session after a completed selection.
        sessionRef.current = new g.maps.places.AutocompleteSessionToken();
        if (place && status === g.maps.places.PlacesServiceStatus.OK) {
          onSelect(parsePlace(place));
        }
      },
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || predictions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % predictions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + predictions.length) % predictions.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(predictions[active]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className={cn("h-9 pl-8", className)}
          placeholder={placeholder}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (predictions.length) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {loading ? <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
      </div>

      {open && predictions.length > 0 ? (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
          {predictions.map((p, i) => (
            <li key={p.place_id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(p); }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  i === active ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <MapPin className="mt-0.5 size-3.5 flex-none text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.structured_formatting?.main_text ?? p.description}</span>
                  {p.structured_formatting?.secondary_text ? (
                    <span className="block truncate text-xs text-muted-foreground">{p.structured_formatting.secondary_text}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
          <li className="px-2 py-1 text-right text-[10px] text-muted-foreground/70">Powered by Google</li>
        </ul>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MapsProvider } from "@/components/maps/maps-provider";
import { env } from "@/lib/env";
import { parsePlace, type PlacePrediction } from "@/lib/google-maps";

export interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  /** ISO alpha-2 from Google ("US", "CA"). */
  country?: string;
  lat?: number;
  lng?: number;
}

/** A pre-filled suggestion shown on focus (e.g. the client's saved addresses). */
export interface AddressSuggestion {
  id: string;
  label: string;
  sublabel?: string;
  onPick: () => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSelect: (addr: ParsedAddress) => void;
  placeholder?: string;
  country?: string;
  className?: string;
  autoFocus?: boolean;
  /**
   * Names the field where the visible label sits on the group around it rather
   * than on this input — a placeholder is not a name, and this control is a
   * combobox, which is announced unnamed without one.
   */
  id?: string;
  ariaLabel?: string;
  /** Shown at the top of the dropdown while the input is focused and near-empty. */
  suggestions?: AddressSuggestion[];
}

/** Header + rows for the saved-address suggestions block in the dropdown. */
function SuggestionBlock({ suggestions }: { suggestions: AddressSuggestion[] }) {
  return (
    <>
      <li className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Client&apos;s saved addresses
      </li>
      {suggestions.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); s.onPick(); }}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60"
          >
            <MapPin className="mt-0.5 size-3.5 flex-none text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{s.label}</span>
              {s.sublabel ? <span className="block truncate text-xs text-muted-foreground">{s.sublabel}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </>
  );
}

/**
 * Street-address input backed by Google Places autocomplete, rendered with our
 * own dropdown (not the default Google widget). On selecting a suggestion,
 * `onSelect` fires with the parsed street/city/state/zip so the caller can fill
 * the rest.
 *
 * Loads Maps through the shared @vis.gl provider so the whole app uses one
 * loader — a hand-injected script alongside @vis.gl makes Google warn about
 * loading the API multiple times. With no key it degrades to a plain input.
 */
export function AddressAutocomplete(props: Props) {
  if (!env.googleMapsApiKey) return <PlainInput {...props} />;
  return (
    <MapsProvider>
      <PlacesInput {...props} />
    </MapsProvider>
  );
}

/** Fallback with no Google key: a plain field that still offers saved addresses. */
function PlainInput({ value, onChange, placeholder, className, autoFocus, id, ariaLabel, suggestions }: Props) {
  const [focused, setFocused] = useState(false);
  const showSuggestions = focused && value.trim().length < 3 && !!suggestions?.length;
  return (
    <div className="relative">
      <MapPin className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className={cn("h-9 pl-8", className)}
        id={id}
        aria-label={ariaLabel}
        placeholder={placeholder ?? "Start typing an address…"}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        autoComplete="off"
      />
      {showSuggestions ? (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
          <SuggestionBlock suggestions={suggestions!} />
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The Google Places side of an address box, shared by the plain input below
 * and the Workiz address field (workiz/address-field.tsx): predictions for
 * the typed text (220ms after the last keystroke, from 3 characters,
 * restricted to `country`), and the parsed address of a chosen one — one
 * billing session per pick. Needs the shared MapsProvider above it.
 */
export function usePlacesAutocomplete(country = "us") {
  const placesLib = useMapsLibrary("places");
  const serviceRef = useRef<InstanceType<NonNullable<Window["google"]>["maps"]["places"]["AutocompleteService"]> | null>(null);
  const placesRef = useRef<InstanceType<NonNullable<Window["google"]>["maps"]["places"]["PlacesService"]> | null>(null);
  const sessionRef = useRef<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ready once Maps has loaded the library; the services are made from it
  // right after, and a query before then simply finds none and waits.
  const ready = Boolean(placesLib);
  const [loading, setLoading] = useState(false);
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);

  useEffect(() => {
    if (!placesLib) return;
    const lib = placesLib as unknown as NonNullable<Window["google"]>["maps"]["places"];
    serviceRef.current = new lib.AutocompleteService();
    placesRef.current = new lib.PlacesService(document.createElement("div"));
    sessionRef.current = new lib.AutocompleteSessionToken();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [placesLib]);

  const query = (input: string) => {
    if (!serviceRef.current || input.trim().length < 3) {
      setPredictions([]);
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
      },
    );
  };

  /** Ask for predictions for this text, once typing pauses. */
  const request = (input: string) => {
    if (!ready) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => query(input), 220);
  };

  /** The parsed address behind a prediction (null when Google says no). */
  const details = (pred: PlacePrediction, onDetails: (addr: ParsedAddress) => void) => {
    setPredictions([]);
    const places = placesRef.current;
    const g = window.google;
    if (!places || !g) return;
    places.getDetails(
      { placeId: pred.place_id, fields: ["address_components", "geometry"], sessionToken: sessionRef.current },
      (place, status) => {
        // Start a fresh billing session after a completed selection.
        sessionRef.current = new g.maps.places.AutocompleteSessionToken();
        if (place && status === g.maps.places.PlacesServiceStatus.OK) onDetails(parsePlace(place));
      },
    );
  };

  return { ready, loading, predictions, request, details, clear: () => setPredictions([]) };
}

function PlacesInput({
  value,
  onChange,
  onSelect,
  placeholder = "Start typing an address…",
  country = "us",
  className,
  autoFocus,
  id,
  ariaLabel,
  suggestions,
}: Props) {
  const places = usePlacesAutocomplete(country);
  const predictions = places.predictions;
  const loading = places.loading;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Open the list whenever a fresh set of predictions arrives.
  const [seen, setSeen] = useState(predictions);
  if (seen !== predictions) {
    setSeen(predictions);
    setActive(0);
    setOpen(predictions.length > 0);
  }

  const handleChange = (v: string) => {
    onChange(v);
    if (v.trim().length < 3) {
      places.clear();
      setOpen(false);
    }
    places.request(v);
  };

  const choose = (pred: PlacePrediction) => {
    setOpen(false);
    onChange(pred.structured_formatting?.main_text ?? pred.description);
    places.details(pred, onSelect);
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
          id={id}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (predictions.length || suggestions?.length) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {loading ? <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
      </div>

      {open && (predictions.length > 0 || (value.trim().length < 3 && !!suggestions?.length)) ? (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
          {value.trim().length < 3 && suggestions?.length ? <SuggestionBlock suggestions={suggestions} /> : null}
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

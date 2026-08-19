"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import type { CountryCode } from "libphonenumber-js";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  callingCode,
  countryOf,
  DEFAULT_COUNTRY,
  formatAsYouType,
  nationalDigits,
  nationalInput,
  phoneCountries,
  toE164,
} from "@/lib/phone";

const COUNTRIES = phoneCountries();

/**
 * The single phone input for the whole app — a national-format field,
 * `(404) 555-1234`, defaulting to the US; the dial code lives on the flag
 * selector, never in the field, so nobody types (or sees) a `+1`. The country
 * only changes when picked by hand — pasting `+1 404…` just sheds its prefix,
 * and a foreign `+code` never flips the flag. It auto-formats as you type and
 * only accepts digits, so a malformed number can't be entered; the value still
 * flows out as E.164 (`+14045551234`) for unambiguous storage.
 */
export function PhoneInput({
  value,
  onChange,
  onBlur,
  className,
  placeholder = "Phone number",
  disabled,
  autoFocus,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
}) {
  const [country, setCountry] = useState<CountryCode>(() =>
    value ? countryOf(value) : DEFAULT_COUNTRY,
  );
  const [text, setText] = useState<string>(() =>
    value ? formatAsYouType(nationalDigits(value), countryOf(value)) : "",
  );
  const lastEmit = useRef<string>(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync when the value changes from outside (form reset, switching records).
  useEffect(() => {
    if ((value ?? "") === lastEmit.current) return;
    const c = value ? countryOf(value) : DEFAULT_COUNTRY;
    setCountry(c);
    setText(value ? formatAsYouType(nationalDigits(value), c) : "");
    lastEmit.current = value ?? "";
  }, [value]);

  const emit = (e164: string) => {
    lastEmit.current = e164;
    onChange(e164);
  };

  const handleChange = (raw: string) => {
    let digits = nationalInput(raw, country);
    // Deleting a formatting character alone would reformat back to the same
    // text and trap the caret — treat it as deleting the digit before it.
    const prev = text.replace(/\D/g, "");
    if (raw.length < text.length && digits === prev) digits = digits.slice(0, -1);
    digits = digits.slice(0, 15 - callingCode(country).length); // E.164 max length
    setText(digits ? formatAsYouType(digits, country) : "");
    emit(digits ? toE164(country, digits) : "");
  };

  const handleCountry = (c: CountryCode) => {
    setCountry(c);
    const digits = text.replace(/\D/g, "");
    setText(digits ? formatAsYouType(digits, c) : "");
    emit(digits ? toE164(c, digits) : "");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div
      className={cn(
        "flex h-9 items-center rounded-md border bg-transparent text-sm shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <CountrySelect value={country} onChange={handleCountry} disabled={disabled} />
      <div className="h-5 w-px flex-none bg-border" />
      <input
        ref={inputRef}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={onBlur}
        className="h-full flex-1 rounded-r-md bg-transparent px-3 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** Typeable/searchable country picker — filter by country name or dial code. */
function CountrySelect({
  value,
  onChange,
  disabled,
}: {
  value: CountryCode;
  onChange: (c: CountryCode) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = COUNTRIES.find((c) => c.country === value);

  return (
    <div className="relative flex-none">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Country code${current ? `: ${current.name} +${current.callingCode}` : ""}`}
        aria-expanded={open}
        className={cn(
          "flex h-9 items-center gap-1 rounded-l-md pl-2.5 pr-1.5",
          disabled ? "cursor-not-allowed" : "hover:bg-muted/50",
        )}
      >
        <span className="text-base leading-none">{current?.flag ?? "🏳️"}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          +{current?.callingCode ?? ""}
        </span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </button>

      {open && !disabled ? (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border bg-popover shadow-md">
            <Command
              loop
              filter={(itemValue, search) => {
                const q = search.trim().toLowerCase().replace(/^\+/, "");
                return itemValue.toLowerCase().includes(q) ? 1 : 0;
              }}
            >
              <CommandInput autoFocus placeholder="Search country or code…" className="h-9" />
              <CommandList className="max-h-64">
                <CommandEmpty>No match.</CommandEmpty>
                {COUNTRIES.map((c) => (
                  <CommandItem
                    key={c.country}
                    value={`${c.name} +${c.callingCode} ${c.country}`}
                    onSelect={() => { onChange(c.country); setOpen(false); }}
                    className="gap-2"
                  >
                    <span className="text-base leading-none">{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="tabular-nums text-muted-foreground">+{c.callingCode}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </div>
        </>
      ) : null}
    </div>
  );
}

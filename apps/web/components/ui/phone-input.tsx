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
  detectInternational,
  formatIntl,
  nationalDigits,
  phoneCountries,
} from "@/lib/phone";

const COUNTRIES = phoneCountries();

/**
 * The single phone input for the whole app — one field that holds the whole
 * international number, `+380 95 860 1427`, with a flag selector on the left
 * (default 🇺🇸). It auto-formats as you type and only accepts digits, so a
 * malformed number can't be entered; there's no separate validation error.
 * The value flows out as E.164 (`+14045551234`) for unambiguous storage.
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
  const [country, setCountry] = useState<CountryCode>(() => (value ? countryOf(value) : "US"));
  const [text, setText] = useState<string>(() => (value ? formatIntl(value) : ""));
  const lastEmit = useRef<string>(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync when the value changes from outside (form reset, switching records).
  useEffect(() => {
    if ((value ?? "") === lastEmit.current) return;
    setText(value ? formatIntl(value) : "");
    if (value) setCountry(countryOf(value));
    lastEmit.current = value ?? "";
  }, [value]);

  const emit = (e164: string) => {
    lastEmit.current = e164;
    onChange(e164);
  };

  const handleChange = (raw: string) => {
    const startsPlus = raw.trimStart().startsWith("+");
    const digits = raw.replace(/\D/g, "").slice(0, 15); // E.164 max length
    // Digits typed without a leading "+" are national in the selected country;
    // otherwise the number carries its own country code.
    const e164 = digits ? (startsPlus ? `+${digits}` : `+${callingCode(country)}${digits}`) : "";
    if (startsPlus) {
      const detected = detectInternational(e164);
      if (detected) setCountry(detected.country);
    }
    setText(e164 ? formatIntl(e164) : "");
    emit(e164);
  };

  const handleCountry = (c: CountryCode) => {
    setCountry(c);
    const national = nationalDigits(value);
    const e164 = national ? `+${callingCode(c)}${national}` : "";
    // Show the new dial-code prefix so the user can keep typing the number.
    setText(formatIntl(e164 || `+${callingCode(c)}`));
    emit(e164);
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
        autoComplete="tel"
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

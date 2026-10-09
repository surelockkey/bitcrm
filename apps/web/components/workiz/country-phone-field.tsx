"use client";

import { useState, type FocusEvent } from "react";
import type { CountryCode } from "libphonenumber-js";

import {
  capNationalDigits,
  countryOf,
  DEFAULT_COUNTRY,
  formatAsYouType,
  nationalDigits,
  nationalInput,
  phoneCountries,
  phoneStatus,
  toE164,
} from "@/lib/phone";
import { cn } from "@/lib/utils";
import { WzOutlinedSelect } from "./outlined-select";
import { WzTextField } from "./text-field";

/** "🇺🇸 +1", "🇺🇦 +380" … — pinned favourites first, as `phoneCountries` orders them. */
const COUNTRY_OPTIONS = phoneCountries().map((c) => ({ value: c.country, label: `${c.flag} +${c.callingCode}` }));

/**
 * Workiz's "+1 | Phone" pair on "Add team member"
 * (subcontractor_wz_04_add_new_user): the country code in a 123×49
 * FloatingLabel select (a flag and "+1") and a 232×48 floating-label "Phone"
 * box 5px after it, filling a 360px column. Our rules inside: the number is
 * typed nationally and formatted as you go ("(404) 555-1234", "95 860 1427"),
 * digits are capped at the country's longest number, the country changes
 * only when picked (a pasted "+1 404…" sheds its prefix; a foreign +code is
 * just digits), and the value out is E.164 ("+14045551234") — what every
 * number is stored and matched as. An unfinished or impossible number says
 * so once the box is left, not while it is being typed.
 */
export function WzCountryPhoneField({
  value,
  onChange,
  onBlur,
  error,
  label = "Phone",
  id,
  disabled,
  className,
}: {
  /** E.164, or "" for none. */
  value: string;
  onChange: (e164: string) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  /** The caller's own complaint; shown instead of the box's. */
  error?: string;
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [country, setCountry] = useState<CountryCode>(() => (value ? countryOf(value) : DEFAULT_COUNTRY));
  const [text, setText] = useState(() => (value ? formatAsYouType(nationalDigits(value), countryOf(value)) : ""));
  const [left, setLeft] = useState(true);
  // A value from outside (a reset, a loaded record) is taken in when the
  // prop changes to something this pair did not just say; a parent that
  // echoes our own E.164 back, or one that never updates the prop at all,
  // leaves the typing alone.
  const [synced, setSynced] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== synced) {
      setSynced(value);
      const c = value ? countryOf(value) : country;
      setCountry(c);
      setText(value ? formatAsYouType(nationalDigits(value), c) : "");
    }
  }

  const digits = text.replace(/\D/g, "");
  const complaint = error ?? (left && digits && phoneStatus(digits, country) !== "valid" ? "Invalid phone number" : undefined);

  const emit = (c: CountryCode, d: string) => {
    const next = d ? toE164(c, d) : "";
    setSynced(next);
    onChange(next);
  };

  return (
    <div data-slot="wz-country-phone" className={cn("grid grid-cols-[123px_minmax(0,1fr)] gap-[5px]", className)}>
      <WzOutlinedSelect
        label="Country code"
        labelHidden
        options={COUNTRY_OPTIONS}
        value={country}
        disabled={disabled}
        controlClassName="h-[49px]"
        onChange={(picked) => {
          const c = picked as CountryCode;
          setCountry(c);
          const d = capNationalDigits(digits, c);
          setText(d ? formatAsYouType(d, c) : "");
          emit(c, d);
        }}
      />
      <WzTextField
        label={label}
        id={id}
        inputMode="tel"
        autoComplete="off"
        overhang={false}
        value={text}
        disabled={disabled}
        error={complaint}
        onChange={(e) => {
          const d = capNationalDigits(nationalInput(e.target.value, country), country);
          setText(d ? formatAsYouType(d, country) : "");
          emit(country, d);
        }}
        onFocus={() => setLeft(false)}
        onBlur={(e) => {
          setLeft(true);
          onBlur?.(e);
        }}
      />
    </div>
  );
}

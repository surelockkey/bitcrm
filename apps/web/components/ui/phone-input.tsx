"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, ChevronsUpDown, CircleAlert } from "lucide-react";
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
  capNationalDigits,
  countryOf,
  DEFAULT_COUNTRY,
  foreignCallingCode,
  formatAsYouType,
  nationalDigits,
  nationalInput,
  phoneCountries,
  phoneStatus,
  toE164,
} from "@/lib/phone";

const COUNTRIES = phoneCountries();

/** "US" for the US (nobody says "United States number"), full name otherwise. */
function countryLabel(country: CountryCode): string {
  if (country === DEFAULT_COUNTRY) return "US";
  return COUNTRIES.find((c) => c.country === country)?.name ?? country;
}

/**
 * The single phone input for the whole app — a national-format field,
 * `(404) 555-1234`, defaulting to the US; the dial code lives on the flag
 * selector, never in the field, so nobody types (or sees) a `+1`. The country
 * only changes when picked by hand — pasting `+1 404…` just sheds its prefix,
 * and a foreign `+code` never flips the flag. It auto-formats as you type and
 * only accepts digits, so a malformed number can't be entered; the value still
 * flows out as E.164 (`+14045551234`) for unambiguous storage.
 *
 * Validation is live, not saved for the submit: a complete real number earns
 * a green check as the last digit lands; digits that already rule the number
 * out go red immediately; a number merely unfinished stays quiet until the
 * field is left, then asks gently — being mid-typing is not an error.
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
  lockCountry,
  usOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  /** Show the country code as a fixed display — no picker to change it. */
  lockCountry?: boolean;
  /**
   * Client numbers are US numbers: the country is pinned to +1 with no
   * picker, typing stops at 10 digits, and a pasted foreign number is
   * refused outright rather than mangled into ten wrong digits. An existing
   * foreign value still shows under its own code — masking history helps
   * nobody — but carries the "US numbers only" flag.
   */
  usOnly?: boolean;
}) {
  const [country, setCountry] = useState<CountryCode>(() =>
    value ? countryOf(value) : DEFAULT_COUNTRY,
  );
  const [text, setText] = useState<string>(() =>
    value ? formatAsYouType(nationalDigits(value), countryOf(value)) : "",
  );
  // Whether the field has been left since it was last typed in — the gate on
  // the "unfinished number" nudge, so it never fires mid-typing.
  const [restedOn, setRestedOn] = useState(false);
  // A foreign paste was refused; cleared by the next accepted keystroke.
  const [refusedPaste, setRefusedPaste] = useState(false);
  const messageId = useId();
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

  // How many digits sit left of the caret — restored after each reformat so
  // editing the middle of a number doesn't fling the caret to the end.
  const caretDigits = useRef<number | null>(null);

  useEffect(() => {
    const n = caretDigits.current;
    caretDigits.current = null;
    const el = inputRef.current;
    if (n == null || !el || document.activeElement !== el) return;
    let pos = 0;
    let seen = 0;
    while (pos < el.value.length && seen < n) {
      if (/\d/.test(el.value[pos])) seen++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
  }, [text]);

  const handleChange = (el: HTMLInputElement) => {
    const raw = el.value;

    // A US-only field refuses a foreign number instead of mangling it into
    // ten wrong digits. The DOM is reset by hand because React only rewrites
    // the input when state changes — and the whole point is that it doesn't.
    if (usOnly && foreignCallingCode(raw)) {
      el.value = text;
      setRefusedPaste(true);
      return;
    }

    const caret = el.selectionStart ?? raw.length;
    let digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, "").length;

    let digits = nationalInput(raw, country);
    // Deleting a formatting character alone would reformat back to the same
    // text and trap the caret — treat it as deleting the digit before the
    // caret (not the last one: the user may be editing the middle).
    const prev = text.replace(/\D/g, "");
    if (raw.length < text.length && digits === prev && digitsBeforeCaret > 0) {
      digits =
        digits.slice(0, digitsBeforeCaret - 1) + digits.slice(digitsBeforeCaret);
      digitsBeforeCaret -= 1;
    }
    digits = digits.slice(0, 15 - callingCode(country).length); // E.164 max length
    // …and at the longest number this country actually has (US: 10 digits).
    digits = capNationalDigits(digits, country);
    caretDigits.current = Math.min(digitsBeforeCaret, digits.length);
    setRefusedPaste(false);
    setRestedOn(false);
    // A cleared US-only field is a US field again, whatever it used to hold.
    const c = usOnly && !digits ? DEFAULT_COUNTRY : country;
    if (c !== country) setCountry(c);
    setText(digits ? formatAsYouType(digits, c) : "");
    emit(digits ? toE164(c, digits) : "");
  };

  const handleCountry = (c: CountryCode) => {
    setCountry(c);
    const digits = text.replace(/\D/g, "");
    setText(digits ? formatAsYouType(digits, c) : "");
    emit(digits ? toE164(c, digits) : "");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // ---- Live verdict --------------------------------------------------
  const digits = text.replace(/\D/g, "");
  const status = phoneStatus(digits, country);
  // A pre-existing foreign value in a US-only field: shown honestly, flagged.
  const foreignValue = !!usOnly && !!digits && country !== DEFAULT_COUNTRY;

  let message: string | undefined;
  let tone: "error" | "nudge" | undefined;
  if (!disabled) {
    if (refusedPaste || foreignValue) {
      message = "US numbers only";
      tone = "error";
    } else if (status === "invalid") {
      message = `Not a valid ${countryLabel(country)} number`;
      tone = "error";
    } else if (status === "incomplete" && restedOn) {
      message =
        country === DEFAULT_COUNTRY
          ? "A US number has 10 digits"
          : "This number looks incomplete";
      tone = "nudge";
    }
  }
  const valid = !disabled && status === "valid" && !foreignValue && !refusedPaste;

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "flex h-9 items-center rounded-md border bg-transparent text-sm shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
          tone === "error" &&
            "border-destructive/60 focus-within:border-destructive focus-within:ring-destructive/20",
          tone === "nudge" &&
            "border-amber-500/60 focus-within:border-amber-500 focus-within:ring-amber-500/20",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {lockCountry || usOnly ? (
          <StaticCountry value={country} />
        ) : (
          <CountrySelect value={country} onChange={handleCountry} disabled={disabled} />
        )}
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
          onChange={(e) => handleChange(e.target)}
          onBlur={() => {
            setRestedOn(true);
            onBlur?.();
          }}
          aria-invalid={tone === "error" || undefined}
          aria-describedby={message ? messageId : undefined}
          className="h-full min-w-0 flex-1 rounded-r-md bg-transparent px-3 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        {valid ? (
          <CheckCircle2
            role="img"
            aria-label="Valid number"
            className="mr-2.5 size-4 flex-none text-emerald-600 dark:text-emerald-400"
          />
        ) : null}
        {tone === "error" ? (
          <CircleAlert
            aria-hidden
            className="mr-2.5 size-4 flex-none text-destructive"
          />
        ) : null}
      </div>
      {message ? (
        <p
          id={messageId}
          role={tone === "error" ? "alert" : undefined}
          className={cn(
            "mt-1 text-xs",
            tone === "error"
              ? "text-destructive"
              : "text-amber-600 dark:text-amber-500",
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Typeable/searchable country picker — filter by country name or dial code. */
/** The country as a fixed, non-interactive prefix — code shown, not changeable. */
function StaticCountry({ value }: { value: CountryCode }) {
  const current = COUNTRIES.find((c) => c.country === value);
  return (
    <span
      className="flex h-9 flex-none items-center gap-1 pl-2.5 pr-1.5 text-muted-foreground"
      aria-label={`Country code${current ? `: ${current.name} +${current.callingCode}` : ""}`}
    >
      <span className="text-base leading-none">{current?.flag ?? "🏳️"}</span>
      <span className="text-xs tabular-nums">+{current?.callingCode ?? ""}</span>
    </span>
  );
}

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

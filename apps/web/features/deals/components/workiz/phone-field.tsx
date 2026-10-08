"use client";

import { useState } from "react";
import { WzTextField, type WzTextFieldProps } from "@/components/workiz";
import {
  capNationalDigits,
  formatAsYouType,
  nationalDigits,
  nationalInput,
  phoneStatus,
  toE164,
} from "@/lib/phone";

/** What a Phone box says about its number once it is left. */
export function phoneFieldError(e164: string): string | undefined {
  if (!e164) return undefined;
  const status = phoneStatus(nationalDigits(e164));
  return status === "valid" ? undefined : "Invalid phone number";
}

/**
 * Workiz's "Phone" box with our number rules: US national format as you type
 * ("(469) 396-8179"), digits capped at a full number, and E.164 out
 * ("+14693968179") so it is stored and matched the way every other number
 * is. An unfinished or impossible number says so once the box is left.
 */
export function WzPhoneField({
  value,
  onChange,
  error,
  onBlur,
  onFocus,
  ...rest
}: Omit<WzTextFieldProps, "value" | "onChange" | "label"> & {
  label?: string;
  value: string;
  onChange: (e164: string) => void;
}) {
  const [text, setText] = useState(() => (value ? formatAsYouType(nationalDigits(value)) : ""));
  const [left, setLeft] = useState(true);
  // What this box last said, so a value from outside (a picked client, a
  // reset) is taken in and an echo of our own typing is not.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value ? formatAsYouType(nationalDigits(value)) : "");
  }

  return (
    <WzTextField
      label="Phone"
      inputMode="tel"
      autoComplete="off"
      {...rest}
      value={text}
      onChange={(e) => {
        const digits = capNationalDigits(nationalInput(e.target.value));
        setText(digits ? formatAsYouType(digits) : "");
        const next = digits ? toE164("US", digits) : "";
        setSynced(next);
        onChange(next);
      }}
      onFocus={(e) => {
        setLeft(false);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setLeft(true);
        onBlur?.(e);
      }}
      error={error ?? (left ? phoneFieldError(value) : undefined)}
    />
  );
}

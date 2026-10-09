"use client";

import { useId, useRef, type ReactNode } from "react";
import { WzInfoTip } from "@/components/workiz/form-section-title";
import { WzShortCodeChips } from "@/components/workiz/phone-tab-parts";
import { cn } from "@/lib/utils";
import { insertAtCursor } from "../lib";

/**
 * Workiz's text-template box (the Texting tab's Job Text Message, On the Way,
 * Running late — Input-module in a FloatingLabel): 96px, 1px #9ea6aa, 4px
 * corners, 13px/16px ink 10.5px 12px in; ink under the cursor, #6aa8ee while
 * focused, a resize grip as Workiz's has.
 */
export const TEXT_TEMPLATE_BOX =
  "block min-h-24 w-full resize-y rounded-[4px] border border-wz-outline bg-white px-3 py-[10.5px] text-[13px] leading-4 tracking-[0.4px] text-foreground outline-none transition-colors placeholder:text-wz-outline-label hover:border-foreground focus:border-wz-link disabled:cursor-not-allowed disabled:border-wz-outline-disabled disabled:bg-wz-disabled-fill aria-invalid:border-wz-error";

/**
 * One of the Texting tab's "Text templates" (pg_settings_phone_wz_texting_scroll1):
 * its name (14px/21px 600 ink, an ⓘ when there is more to say), the box,
 * the 12px helper under it, and the short-code chips that put `{{code}}` in
 * where the caret was (at the end when the box was never clicked).
 */
export function TextTemplateField({
  label,
  info,
  value,
  onChange,
  codes,
  helper,
  error,
  placeholder,
  disabled,
  rows = 4,
  className,
  children,
}: {
  label: string;
  info?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  codes: readonly string[];
  helper?: ReactNode;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  className?: string;
  /** Under the chips: Workiz's "Notify me…" checkbox spot. */
  children?: ReactNode;
}) {
  const id = useId();
  const caret = useRef<{ start: number; end: number } | null>(null);
  const remember = (el: HTMLTextAreaElement) => {
    caret.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  return (
    <div data-slot="text-template-field" className={cn("min-w-0", className)}>
      <div className="mb-2 flex items-center">
        <label htmlFor={id} className="text-sm leading-[21px] font-semibold tracking-[0.4px] text-foreground">
          {label}
        </label>
        {info ? <WzInfoTip label={label} text={info} /> : null}
      </div>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          remember(e.target);
          onChange(e.target.value);
        }}
        onSelect={(e) => remember(e.currentTarget)}
        onKeyUp={(e) => remember(e.currentTarget)}
        className={TEXT_TEMPLATE_BOX}
      />
      {error ? (
        <p role="alert" className="mt-1 pl-3 text-xs leading-[18px] tracking-[0.4px] text-wz-error">
          {error}
        </p>
      ) : helper ? (
        <p className="mt-1 pl-3 text-xs leading-[18px] tracking-[0.4px] text-foreground">{helper}</p>
      ) : null}
      {codes.length > 0 ? (
        <WzShortCodeChips
          className="mt-4"
          label={`Short codes for ${label}`}
          codes={codes}
          disabled={disabled}
          onInsert={(code) => {
            const at = caret.current ?? { start: value.length, end: value.length };
            const next = insertAtCursor(value, code, at.start, at.end);
            caret.current = { start: next.caret, end: next.caret };
            onChange(next.value);
          }}
        />
      ) : null}
      {children}
    </div>
  );
}

"use client";

import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { WzFieldError } from "./messages";
import { WzMiniToggle } from "./switch-tabs";

/*
 * Workiz's settings forms that are not catalogs (pg_settings_general_wz_*,
 * notes workiz-data-parser/docs/import/app-parity-2026-10-08/pg_settings_general.md):
 *
 * - the Account page (/root/account, avatar menu → Account): a 652px column
 *   of FloatingLabel boxes (`WzOutlinedTextField`, `WzOutlinedSelect`) under
 *   an h3 (`WzAccountTitle`), then "Account Preferences" with its toggle rows
 *   (`WzAccountToggle`), the Save in the bottom `sbmt_bar` (`WzActionBar`);
 * - Workiz Pay → My account (/root/workizPay/account): MyAccount-module
 *   sections (`WzPaySection`) of label rows with the control at the right
 *   (`WzPayRow`);
 * - the template editor's "Document settings" drawer: the Subject / Message
 *   boxes (`WzDocSettingsField`).
 */

/** The Account page's h3 ("Account", "Account Preferences"): 20px/24px 600 ink. */
export function WzAccountTitle({ className, ...rest }: ComponentProps<"h3">) {
  return (
    <h3
      data-slot="wz-account-title"
      {...rest}
      className={cn("text-xl leading-6 font-semibold tracking-[0.4px] text-foreground", className)}
    />
  );
}

/**
 * An Account Preferences toggle row ("Update Job End Time", "Allow Multiple
 * Techs"): the words 13px/19px ink, the hint 12px/18px #768287 right under
 * them, the 32×16 Toggle-module at the column's right edge, 2px down. Rows
 * stand 38px apart (`gap-[38px]` on their column, as 598 → 655 measures with
 * a hint between).
 */
export function WzAccountToggle({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const hintId = useId();
  return (
    <div data-slot="wz-account-toggle" className={cn("flex items-start justify-between gap-6", className)}>
      <div className="min-w-0">
        <p className="text-[13px] leading-[19px] tracking-[0.4px] text-foreground">{label}</p>
        {hint ? (
          <p id={hintId} className="mt-1 text-xs leading-[18px] tracking-[0.4px] text-wz-outline-label">
            {hint}
          </p>
        ) : null}
      </div>
      <WzMiniToggle
        label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className="mt-0.5"
      />
    </div>
  );
}

/**
 * A Workiz Pay → My account section (MyAccount-module__myAccountSection): a
 * 1px #dfe2e3 rule over it (not over the first), 40px above and below; the
 * h3 20px/24px 600 ink, the h4 18px/27px #768287 4px under it, the rows 24px
 * under that and 24px apart.
 */
export function WzPaySection({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-slot="wz-pay-section"
      className={cn("border-t border-border py-10 first:border-t-0 first:pt-10", className)}
    >
      <h3 id={titleId} className="text-xl leading-6 font-semibold tracking-[0.4px] text-foreground">
        {title}
      </h3>
      {subtitle ? (
        <p className="mt-1 text-lg leading-[27px] font-normal tracking-[0.4px] text-wz-outline-label">{subtitle}</p>
      ) : null}
      {children ? <div className="mt-6 flex flex-col gap-6">{children}</div> : null}
    </section>
  );
}

/**
 * A My account row ("Accept bank transfers (ACH)", "Service fee amount"): the
 * words 14px/21px 500 ink at the left (a real <label> with `htmlFor`), the
 * control at the right edge; `hint` 12px/18px #768287 under the words.
 */
export function WzPayRow({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const words = "text-sm leading-[21px] font-medium tracking-[0.4px] text-foreground";
  return (
    <div data-slot="wz-pay-row" className={cn("flex items-center justify-between gap-6", className)}>
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={cn("block", words)}>
            {label}
          </label>
        ) : (
          <p className={words}>{label}</p>
        )}
        {hint ? <p className="mt-0.5 text-xs leading-[18px] tracking-[0.4px] text-wz-outline-label">{hint}</p> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-3">{children}</div> : null}
    </div>
  );
}

/**
 * The template editor's "Document settings" Subject / Message
 * (pg_settings_general_wz_doc_settings_open): an h5-sized label 16px/24px 600
 * ink, 6px over a #f7f7f7 box (1px #e1e1e1, 2px corners, 10px in, 13.33px /
 * 17.33px #666), the helper 11px/13px #999 right under it.
 */
export function WzDocSettingsField({
  label,
  helper,
  error,
  multiline = true,
  className,
  id,
  ...rest
}: {
  /** "Subject", "Message" — words, or words with an sr-only qualifier ("Invoice "). */
  label: ReactNode;
  helper?: ReactNode;
  error?: string;
  /** A textarea (Message) or a one-line box (Subject). */
  multiline?: boolean;
  className?: string;
} & Omit<ComponentProps<"textarea"> & ComponentProps<"input">, "className" | "ref">) {
  const autoId = useId();
  const boxId = id ?? `wz-doc-${autoId}`;
  const helperId = `${boxId}-helper`;
  const errorId = `${boxId}-error`;
  // #e1e1e1: the Document settings box's edge, a one-off (doc_settings_open).
  const box =
    "block w-full rounded-[2px] border border-[#e1e1e1] bg-muted p-2.5 text-[13.33px] leading-[17.33px] tracking-[0.4px] text-wz-text outline-none transition-colors focus:border-wz-link disabled:cursor-not-allowed aria-invalid:border-wz-error";
  const describedBy = cn(helper && helperId, error && errorId) || undefined;
  return (
    <div data-slot="wz-doc-settings-field" className={cn("flex flex-col", className)}>
      <label htmlFor={boxId} className="mb-1.5 text-base leading-6 font-semibold tracking-[0.4px] text-foreground">
        {label}
      </label>
      {multiline ? (
        <textarea
          {...(rest as ComponentProps<"textarea">)}
          id={boxId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(box, "min-h-[126px] resize-y")}
        />
      ) : (
        <input
          {...(rest as ComponentProps<"input">)}
          id={boxId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(box, "h-[40px]")}
        />
      )}
      {helper ? (
        <small id={helperId} className="text-[11px] leading-[13px] tracking-[0.4px] text-wz-caption">
          {helper}
        </small>
      ) : null}
      {error ? <WzFieldError id={errorId}>{error}</WzFieldError> : null}
    </div>
  );
}

"use client";

import { useId, useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, X } from "lucide-react";
import type { TextAlign } from "@bitcrm/types";
import { safeColor } from "@bitcrm/document-renderer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function PanelSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-2.5 border-b px-3 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

export function FieldRow({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

function toHex6(v: string | undefined): string {
  if (!v) return "#000000";
  if (HEX.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return "#000000";
}

/** Native swatch + hex text. `allowEmpty` adds a clear button (value → undefined). */
export function ColorField({
  label,
  value,
  onChange,
  allowEmpty,
  placeholder = "Default",
  disabled,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  // Follow outside changes (undo, another control) without an effect.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value ?? "");
  }

  const commitText = (t: string) => {
    const v = t.trim();
    if (!v) {
      if (allowEmpty) onChange(undefined);
      else setText(value ?? "");
      return;
    }
    const withHash = /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? `#${v}` : v;
    if (safeColor(withHash)) onChange(withHash);
    else setText(value ?? "");
  };

  return (
    <FieldRow label={label} htmlFor={id}>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={toHex6(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "size-8 flex-none cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed",
            !value && "opacity-50",
          )}
        />
        <Input
          id={id}
          className="h-8 font-mono text-xs"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={32}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitText((e.target as HTMLInputElement).value);
          }}
        />
        {allowEmpty && value ? (
          <button
            type="button"
            className="flex size-7 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label={`Clear ${label}`}
            onClick={() => onChange(undefined)}
            disabled={disabled}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
    </FieldRow>
  );
}

/**
 * A number input that commits valid, clamped values while typing and restores
 * the last good value on blur. Empty commits `undefined` when `allowEmpty`.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  allowEmpty,
  placeholder,
  disabled,
  className,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  allowEmpty?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value === undefined ? "" : String(value));
  }

  const parse = (t: string): number | undefined | null => {
    if (t.trim() === "") return allowEmpty ? undefined : null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  };

  return (
    <div className={className}>
      <FieldRow label={label} htmlFor={id}>
        <div className="relative">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            className={cn("h-8 text-xs", suffix && "pr-8")}
            min={min}
            max={max}
            step={step}
            value={text}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              const n = parse(e.target.value);
              if (n !== null && (n === undefined || (n >= min && n <= max && String(n) === e.target.value.trim()))) onChange(n);
            }}
            onBlur={(e) => {
              const n = parse(e.target.value);
              if (n === null) setText(value === undefined ? "" : String(value));
              else {
                onChange(n);
                setText(n === undefined ? "" : String(n));
              }
            }}
          />
          {suffix ? (
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-muted-foreground">{suffix}</span>
          ) : null}
        </div>
      </FieldRow>
    </div>
  );
}

export function SwitchRow({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-xs font-normal">
          {label}
        </Label>
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/** A compact segmented control (radio group). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T | undefined;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-md border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.icon ? o.label : undefined}
          title={o.label}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 flex-1 items-center justify-center gap-1 rounded-[5px] text-xs transition-colors",
            value === o.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon ?? o.label}
        </button>
      ))}
    </div>
  );
}

export const ALIGN_OPTIONS: { value: TextAlign; label: string; icon: ReactNode }[] = [
  { value: "left", label: "Align left", icon: <AlignLeft className="size-3.5" /> },
  { value: "center", label: "Align center", icon: <AlignCenter className="size-3.5" /> },
  { value: "right", label: "Align right", icon: <AlignRight className="size-3.5" /> },
];

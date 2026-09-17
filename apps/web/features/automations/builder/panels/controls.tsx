"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  AutomationValuePicker,
  type PickerOption,
} from "../../components/automation-value-picker";

/**
 * The small parts every node panel is built from. They exist so the seven
 * panels read alike: the same underlined slot, the same segmented switch, the
 * same way a field is labelled — Workiz's sentence-with-slots, drawn with our
 * components (§8.2: underlined means pressable, and nothing else is).
 */

/**
 * One underlined word of a sentence, opened as a searchable list.
 *
 * It is `AutomationValuePicker` in `slot` dress rather than a control of its
 * own: the search box, the keyboard path through the list, the outside-click
 * close and the "picked but not offered here" escape hatch are all already
 * there and already tested, and a second popover would be a second set of
 * those bugs.
 */
export function Slot({
  label,
  value,
  options,
  onChange,
  onClear,
  placeholder,
  disabled,
  emptyText,
  className,
}: {
  /** Accessible name — what this slot chooses ("Trigger entity"). */
  label: string;
  value: string | undefined;
  options: PickerOption[];
  onChange: (id: string) => void;
  /**
   * What "none of these" means, where it means anything. Most slots are a
   * word of a sentence and emptying one would leave a hole where a reader
   * expects a noun, so without this the only way out of a slot is another
   * value — and re-picking what it already holds does nothing at all.
   */
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  className?: string;
}) {
  return (
    <AutomationValuePicker
      variant="slot"
      single
      clearable={Boolean(onClear)}
      label={label}
      options={options}
      values={value ? [value] : []}
      onChange={(ids) => {
        if (ids[0]) onChange(ids[0]);
        else onClear?.();
      }}
      placeholder={placeholder ?? "choose…"}
      emptyText={emptyText ?? "Nothing to pick"}
      disabled={disabled}
      className={className}
    />
  );
}

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  /** Workiz's own glyph for the operator: `=`, `≠`. Decorative — the label is the name. */
  symbol?: string;
}

/**
 * A row of mutually exclusive choices, all of them visible (Workiz's operator
 * switch, §5.2). A menu hides the alternatives behind a press; a rule's
 * operator is the one thing in a condition that flips its meaning, so it is
 * worth the width.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: T;
  options: Array<SegmentOption<T>>;
  onChange: (id: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex flex-wrap items-center gap-0.5 rounded-lg border p-0.5", className)}
    >
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              on ? "bg-brand/10 text-brand" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {option.symbol ? (
              <span aria-hidden="true" className="font-mono opacity-70">
                {option.symbol}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The sentence a panel opens with — slots sit inside it, on one wrapping line. */
export function PanelSentence({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm leading-7 text-muted-foreground">
      {children}
    </p>
  );
}

/** A titled block inside a panel, for what a slot reveals. */
export function PanelSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
    </section>
  );
}

/**
 * A labelled control. A `children` function is handed an id to put on a real
 * form control, and the label points at it; anything else is named by itself
 * — the pickers carry their own `aria-labelledby`, and a `for` pointing at an
 * element that does not exist is worse than no `for` at all.
 */
export function PanelField({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode | ((id: string) => ReactNode);
  className?: string;
}) {
  const id = useId();
  const tied = typeof children === "function";
  return (
    <div className={cn("space-y-1.5", className)}>
      {tied ? (
        <label htmlFor={id} className="block text-xs font-medium">
          {label}
        </label>
      ) : (
        <p className="text-xs font-medium">{label}</p>
      )}
      {tied ? (children as (id: string) => ReactNode)(id) : children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

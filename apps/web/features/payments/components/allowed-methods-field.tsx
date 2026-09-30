"use client";

import type { OnlinePaymentMethod } from "@bitcrm/types";
import { Checkbox } from "@/components/ui/checkbox";
import { usePaymentSettings } from "../hooks";
import { PAYMENT_METHOD_META, availableOnlineMethods, paymentMethodLabel } from "../lib";

/**
 * Workiz's "Let client pay with" — the methods offered on THIS invoice, picked
 * at send time. `null` means "whatever the account allows", which is what an
 * invoice that was never narrowed carries.
 *
 * Renders nothing when the account has no online payments to offer: there is
 * no choice to make, and the Pay button won't appear either way.
 */
export function AllowedMethodsField({
  value,
  onChange,
  disabled,
}: {
  value: OnlinePaymentMethod[] | null;
  onChange: (methods: OnlinePaymentMethod[]) => void;
  disabled?: boolean;
}) {
  const { data: settings } = usePaymentSettings();
  const offered = availableOnlineMethods(settings);
  if (offered.length === 0) return null;

  const checked = value ?? offered;

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Let client pay with</legend>
      <div className="flex flex-wrap items-center gap-4">
        {offered.map((m) => {
          const Icon = PAYMENT_METHOD_META[m].icon;
          return (
            <label key={m} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={checked.includes(m)}
                disabled={disabled}
                aria-label={paymentMethodLabel(m)}
                onCheckedChange={(v) =>
                  onChange(v === true ? offered.filter((o) => o === m || checked.includes(o)) : checked.filter((o) => o !== m))
                }
              />
              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
              {paymentMethodLabel(m)}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {checked.length === 0
          ? "The client will see this invoice but won't be able to pay it online."
          : "Shown as payment options on the client's copy of this invoice."}
      </p>
    </fieldset>
  );
}

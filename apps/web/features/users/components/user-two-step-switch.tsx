"use client";

import { useState } from "react";
import type { User } from "@bitcrm/types";
import { Switch } from "@/components/ui/switch";
import { useSetUserMfa } from "../hooks";

/**
 * An admin's switch for someone's two-step sign-in. Off works for anyone — a
 * lost phone should not lock a person out. On needs a phone on their profile;
 * their next sign-in texts the code to it. Saves on its own, not with the
 * profile form.
 */
export function UserTwoStepSwitch({ user, canEdit }: { user: User; canEdit: boolean }) {
  const set = useSetUserMfa();
  const [enabled, setEnabled] = useState(!!user.smsMfaEnabled);
  const [seen, setSeen] = useState(user.smsMfaEnabled);
  if (seen !== user.smsMfaEnabled) {
    setSeen(user.smsMfaEnabled);
    setEnabled(!!user.smsMfaEnabled);
  }

  const noPhone = !user.phone;
  const disabled = !canEdit || set.isPending || (noPhone && !enabled);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="space-y-0.5">
        <label htmlFor={`two-step-${user.id}`} className="text-sm font-medium">
          Two-step sign-in
        </label>
        <p className="text-xs text-muted-foreground">
          {noPhone && !enabled
            ? "No phone on this profile to text the code to."
            : "After the password, a code is texted to their phone."}
        </p>
      </div>
      <Switch
        id={`two-step-${user.id}`}
        aria-label="Two-step sign-in"
        checked={enabled}
        disabled={disabled}
        onCheckedChange={(next) =>
          set.mutate({ id: user.id, enabled: next }, { onSuccess: (u) => setEnabled(!!u.smsMfaEnabled) })
        }
      />
    </div>
  );
}

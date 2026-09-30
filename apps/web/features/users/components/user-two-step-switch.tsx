"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { User } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { Switch } from "@/components/ui/switch";
import { getApiErrorMessage } from "@/lib/api/errors";
import { isValidPhone } from "@/lib/phone";
import { queryKeys } from "@/lib/query-keys";
import * as api from "../api";
import { useSetUserMfa } from "../hooks";
import { TwoStepStatus } from "./two-step-status";

/**
 * An admin's switch for someone's two-step sign-in. Saves on its own, reads
 * On / Off at a glance. Off works for anyone — a lost phone must not lock a
 * person out. On needs a phone to text: when the profile has none, the row
 * asks for it right here instead of sitting greyed out; the person's next
 * sign-in texts that number.
 */
export function UserTwoStepSwitch({ user, canEdit }: { user: User; canEdit: boolean }) {
  const qc = useQueryClient();
  const set = useSetUserMfa();
  const [enabled, setEnabled] = useState(!!user.smsMfaEnabled);
  const [seen, setSeen] = useState(user.smsMfaEnabled);
  if (seen !== user.smsMfaEnabled) {
    setSeen(user.smsMfaEnabled);
    setEnabled(!!user.smsMfaEnabled);
  }
  const [askPhone, setAskPhone] = useState(false);
  const [phone, setPhone] = useState("");

  // Save the phone to their profile, then switch on.
  const phoneThenOn = useMutation({
    mutationFn: async () => {
      await api.updateUser(user.id, { phone });
      return api.setUserMfa(user.id, true);
    },
    onSuccess: (u) => {
      setEnabled(!!u.smsMfaEnabled);
      setAskPhone(false);
      qc.invalidateQueries({ queryKey: queryKeys.users.all() });
      toast.success("Two-step sign-in switched on");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  const busy = set.isPending || phoneThenOn.isPending;

  const onToggle = (next: boolean) => {
    if (askPhone && !next) {
      setAskPhone(false);
      return;
    }
    if (next && !user.phone) {
      setAskPhone(true);
      return;
    }
    set.mutate({ id: user.id, enabled: next }, { onSuccess: (u) => setEnabled(!!u.smsMfaEnabled) });
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <label htmlFor={`two-step-${user.id}`} className="text-sm font-medium">
              Two-step sign-in
            </label>
            <TwoStepStatus enabled={enabled} />
          </div>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "After the password, a code is texted to their phone."
              : "Off: password only. Turn on to also text them a code."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          <Switch
            id={`two-step-${user.id}`}
            aria-label="Two-step sign-in"
            checked={enabled || askPhone}
            disabled={!canEdit || busy}
            onCheckedChange={onToggle}
          />
        </div>
      </div>

      {askPhone ? (
        <div data-testid="two-step-phone" className="space-y-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {user.firstName} has no phone on their profile. Add the number their codes should go to:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <PhoneInput className="h-9 w-64" value={phone} onChange={setPhone} autoFocus />
            <Button
              type="button"
              variant="brand"
              size="sm"
              disabled={!isValidPhone(phone) || busy}
              onClick={() => phoneThenOn.mutate()}
            >
              Save & turn on
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAskPhone(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

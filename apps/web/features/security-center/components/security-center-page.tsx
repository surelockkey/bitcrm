"use client";

import { DEFAULT_SECURITY_SETTINGS, type SecuritySettings } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzLeadToggleRow } from "@/components/workiz/lead-toggle-row";
import { WzSettingsSection, WzSettingsTitle } from "@/components/workiz/settings-title";
import { settled } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { useSecuritySettings, useUpdateSecuritySettings } from "../hooks";

type Switch = keyof Pick<SecuritySettings, "requireMfa" | "loginCodeByEmail" | "otpByEmail">;

/**
 * Settings → Security Center, Workiz's (`/root/securityCenter`,
 * feat_security_wz_security): no grey band — the plain title with its ⓘ,
 * then "Two-factor authentication (2FA)" over a rule, its line, and three
 * rows with the switch before the words. A switch saves the moment it is
 * flipped (Workiz has no Save here) and reads back what the server kept;
 * only `settings.edit` may flip one. Workiz's "Learn More" (its help site)
 * and "Support PIN code" (its support desk) are its own and not drawn.
 *
 * One skeleton while the permissions and the row load, then the whole page.
 * Until the server knows the row (a dev API from before it), the defaults
 * show, read-only.
 */
export function SecurityCenterPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canRead = can("settings");
  const canEdit = can("settings", "edit");
  const query = useSecuritySettings(canRead);
  const save = useUpdateSecuritySettings();

  // A refusal only once the answer is in — before it, `can` says no to all.
  if (denied("settings")) return <NoAccess what="settings" />;
  if (permsLoading || !settled(query)) {
    return (
      <div className="flex min-w-0 flex-1 flex-col pt-[39px] pl-10">
        <Skeleton className="h-72 w-[828px] max-w-full" />
      </div>
    );
  }

  const settings = query.data ?? DEFAULT_SECURITY_SETTINGS;
  const locked = !canEdit || query.isError || save.isPending;
  const flip = (key: Switch) => (value: boolean) => save.mutate({ [key]: value });

  return (
    <div className="flex min-w-0 flex-1 flex-col pt-[39px] pb-16">
      <WzSettingsTitle className="mb-6 pl-10" tip="Two-factor authentication for everyone who signs in, and how the codes reach them.">
        Security center
      </WzSettingsTitle>

      <WzSettingsSection
        title="Two-factor authentication (2FA)"
        description="Protect your account’s sensitive information by adding an extra step to the login process."
      >
        <WzLeadToggleRow
          label="Require Two-factor authentication (2FA)"
          hint="When this is selected you’ll be required to use 2FA to log in with a one-time code from your phone."
          checked={settings.requireMfa}
          onCheckedChange={flip("requireMfa")}
          disabled={locked}
        />
        <WzLeadToggleRow
          label="Login sending options"
          hint="You can choose to receive an email message with a verification code when you log in to BitCRM"
          checked={settings.loginCodeByEmail}
          onCheckedChange={flip("loginCodeByEmail")}
          disabled={locked}
        />
        <WzLeadToggleRow
          label="OTP sending options"
          hint="You can choose to receive an email message with a verification code when you do in-app authentication (e.g., when exporting data)"
          checked={settings.otpByEmail}
          onCheckedChange={flip("otpByEmail")}
          disabled={locked}
        />
      </WzSettingsSection>
    </div>
  );
}

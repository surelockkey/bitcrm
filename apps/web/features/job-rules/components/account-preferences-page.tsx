"use client";

import { SlidersHorizontal } from "lucide-react";
import { DEFAULT_JOB_RULES_SETTINGS } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzAccountTitle, WzAccountToggle } from "@/components/workiz/settings-form";
import { WzSettingsHeader } from "@/components/workiz/settings-page";
import { usePermissions } from "@/features/auth/use-permissions";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useJobRules, useUpdateJobRules } from "../hooks";

/**
 * Settings → Account Preferences: Workiz's Account page "Account
 * Preferences" block (pg_settings_general_wz_account_scroll1) — the toggle
 * rows that change what happens to a job. Ours holds the one we enforce,
 * "Update Job End Time", with Workiz's words and hint; Workiz saves the
 * page with its bottom Save, ours saves the row the moment it is flipped,
 * as the catalogs' switches do. Read-only without `settings.edit`.
 */
export function AccountPreferencesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const canEdit = can("settings", "edit");
  const rulesQuery = useJobRules();
  const rules = rulesQuery.data ?? DEFAULT_JOB_RULES_SETTINGS;
  const update = useUpdateJobRules();
  // One skeleton until the rules and the right to change them are in.
  const ready = usePageReady(!permsLoading && settled(rulesQuery));

  return (
    <div className="flex min-w-0 flex-1 flex-col px-5 pt-5 pb-10">
      <WzSettingsHeader
        icon={<SlidersHorizontal />}
        title="Account Preferences"
        description="What happens to a job on its own — the account-wide rules."
      />

      {!ready ? (
        <Skeleton className="mt-5 h-40 w-full rounded-none" />
      ) : (
        // Workiz's 652px column under the h3, the rows 38px apart.
        <section aria-labelledby="account-preferences-title" className="mt-10 ml-[30px] flex w-[652px] max-w-full flex-col gap-[38px]">
          <WzAccountTitle id="account-preferences-title">Account Preferences</WzAccountTitle>
          <WzAccountToggle
            label="Update Job End Time"
            hint="Auto update the job end time on job done or canceled."
            checked={rules.updateJobEndTimeOnClose}
            disabled={!canEdit || update.isPending}
            onCheckedChange={(on) => update.mutate({ updateJobEndTimeOnClose: on })}
          />
        </section>
      )}
    </div>
  );
}

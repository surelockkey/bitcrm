"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { DEFAULT_ESTIMATE_SETTINGS, type EstimateSettings } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButtonLink } from "@/components/workiz/button";
import { WzMiniToggle } from "@/components/workiz/switch-tabs";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { useEstimateSettings, useUpdateEstimateSettings } from "../hooks";

type Switch = "attachPdf" | "autoDeclineSameJob";

/** Billing's `DEFAULT_ESTIMATE_TEMPLATE_ID` — the estimate template "Customize template" opens. */
const ESTIMATE_TEMPLATE_HREF = "/settings/documents/tpl-default-estimate";

/**
 * Workiz's rows, its words (settings_audit_wz_estimates_settings_v3). Of its
 * six, these two are switches of ours; the other four (view estimates for
 * done jobs, lock approved estimates, card on file for deposits, pay the
 * deposit later) are fixed behaviours here, so they are not drawn as
 * controls.
 */
const ROWS: Array<{ key: Switch; label: string; hint: string }> = [
  { key: "attachPdf", label: "Attach PDF files", hint: "Send your clients PDF copy of estimates" },
  {
    key: "autoDeclineSameJob",
    label: "Auto-decline estimates related to the same job",
    hint: "When enabled, approving one estimate will automatically decline all others for that job. When disabled, other estimates remain pending.",
  },
];

/**
 * Settings → Estimates, Workiz's `/root/estimatesSettings`: the 25px title
 * with "Customize template" at the right, then rows of a 32×16 toggle, the
 * 13px/600 words 16px right of it and the 13px/19px hint 4px under them,
 * rows 20px apart. A switch saves on the click, as Workiz's does.
 */
export function EstimateSettingsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canRead = can("settings");
  const canEdit = can("settings", "edit");
  const { data: settings, isLoading } = useEstimateSettings(canRead);
  const save = useUpdateEstimateSettings();
  // The switch as clicked, until the server answers (then its answer shows — the old state if refused).
  const [pending, setPending] = useState<Partial<EstimateSettings>>({});

  const flip = (key: Switch, value: boolean) => {
    setPending({ [key]: value });
    save.mutate({ [key]: value }, { onSettled: () => setPending({}) });
  };

  if (denied("settings")) return <NoAccess what="settings" />;
  if (permsLoading || isLoading) {
    return (
      <div className="flex min-w-0 flex-1 flex-col px-10 pt-[14px]">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // A backend without the settings yet (the dev API behind a web-only deploy)
  // answers nothing: the rows show the account's defaults rather than a
  // skeleton forever; a save then says what went wrong.
  const shown: EstimateSettings = { ...DEFAULT_ESTIMATE_SETTINGS, ...settings, ...pending };

  return (
    <div className="flex min-w-0 flex-1 flex-col px-10 pt-[14px] pb-10">
      <div className="flex items-start justify-between gap-6">
        {/* #404040, 25px/37px 500 (estimatesSettings-module__title). */}
        <h2 className="text-[25px] leading-[37px] font-medium tracking-[0.4px] text-wz-strong">Estimates settings</h2>
        <WzButtonLink variant="secondary" size="regular" href={ESTIMATE_TEMPLATE_HREF} icon={<FileText />} className="mt-0.5 min-w-[195px]">
          Customize template
        </WzButtonLink>
      </div>
      <div className="mt-6 flex flex-col gap-5">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-start gap-4">
            <WzMiniToggle
              label={row.label}
              checked={shown[row.key]}
              onCheckedChange={(v) => flip(row.key, v)}
              disabled={!canEdit || save.isPending}
            />
            <div className="min-w-0 max-w-[552px]">
              <p className="text-[13px] leading-4 font-semibold tracking-[0.4px] text-foreground">{row.label}</p>
              <p className="mt-1 text-[13px] leading-[19px] tracking-[0.4px] text-foreground">{row.hint}</p>
            </div>
          </div>
        ))}
      </div>
      {!canEdit ? (
        <p className="mt-6 text-xs leading-[18px] text-wz-outline-label">Changing these needs the &quot;settings · edit&quot; permission.</p>
      ) : null}
    </div>
  );
}

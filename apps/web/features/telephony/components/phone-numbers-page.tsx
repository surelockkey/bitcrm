"use client";

import { useMemo, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WzButton } from "@/components/workiz/button";
import { WzTrashIcon } from "@/components/workiz/icons";
import { WzLocalGrid, type WzGridColumn } from "@/components/workiz/local-grid";
import { WzRowIconButton, WzTabIntro, WzTag } from "@/components/workiz/phone-tab-parts";
import { formatPhone } from "@/lib/phone";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { JobSourceSelect } from "@/features/job-sources/components/job-source-select";
import { useActiveJobSources } from "@/features/job-sources/active-hooks";
import { BusinessProfileSelect } from "@/features/business-profiles/components/business-profile-select";
import { useActiveBusinessProfiles } from "@/features/business-profiles/hooks";
import {
  useNumbers,
  useNumberSettings,
  useReleaseNumber,
  useSetTechnicianLine,
  useUpdateNumberSettings,
} from "../numbers-hooks";
import { useAssignNumberFlow, useCallFlows } from "../call-flows-hooks";
import type { OwnedNumber } from "../numbers-api";
import { flowOfNumber, formatNumberCreated } from "../phone-settings";
import { BuyNumberDialog } from "./buy-number-dialog";
import { NumberFlowSelect } from "./number-flow-select";

/** Workiz's red "Remove ad group" / "Remove flow" under a row's select: 14px #ff6f64, underlined, 10px under it. */
function RemoveLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // #ff6f64: Workiz's `unassingFlow` red (pg_settings_phone_wz_numbers), a one-off.
      className="mt-2.5 block cursor-pointer text-sm leading-4 tracking-[0.4px] text-[#ff6f64] underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-wz-focus"
    >
      {label}
    </button>
  );
}

const NUMBERS_INTRO =
  "Manage your phone numbers and assign them to call flows. You can get multiple phone numbers and use them in your online and offline campaigns.";

/**
 * Workiz Phone → Phone numbers (`/calls/numbers`; Settings → Phone Numbers
 * lands here as Workiz's does): its words and "Add number", then the
 * react-table — Number | Ad group | Flow | Created | Action
 * (pg_settings_phone_wz_numbers). Ours, kept in Workiz's style: the
 * Company column (a number's company overrides its flow's) and the
 * technician line — a dark tag under the number, as Workiz tags its own
 * number, and the key beside the bin.
 */
export function PhoneNumbersPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const denied = useDenied();
  const numbersQuery = useNumbers(true);
  const settingsQuery = useNumberSettings(can("settings"));
  const flowsQuery = useCallFlows(can("settings"));
  const { data: numbers } = numbersQuery;
  const { data: numberSettings } = settingsQuery;
  const flows = useMemo(() => flowsQuery.data ?? [], [flowsQuery.data]);
  // What the pickers in each row name their value from — asked for here, by
  // the same hooks the pickers call, rather than by the pickers once the
  // table is up: "No source" used to turn into the source's name a beat
  // after the rows were drawn.
  const sources = useActiveJobSources();
  const companies = useActiveBusinessProfiles();
  const ready = usePageReady(
    !permissionsLoading && [numbersQuery, settingsQuery, flowsQuery, sources, companies].every(settled),
  );
  const updateSettings = useUpdateNumberSettings();
  const assignFlow = useAssignNumberFlow();
  const release = useReleaseNumber();
  const setTechLine = useSetTechnicianLine();

  const [buyOpen, setBuyOpen] = useState(false);
  const [deleting, setDeleting] = useState<OwnedNumber | undefined>();

  const canManage = can("settings", "edit");

  const columns = useMemo<WzGridColumn<OwnedNumber>[]>(() => {
    const settingsOf = (phoneNumber: string) => numberSettings?.find((s) => s.phoneNumber === phoneNumber);
    const sourceName = (id?: string) => (id ? sources.data?.find((s) => s.id === id)?.name : undefined);
    return [
      {
        id: "number",
        label: "Number",
        width: 230,
        cellClassName: "whitespace-normal",
        sortValue: (n) => n.phoneNumber,
        searchText: (n) => `${formatPhone(n.phoneNumber)} ${n.phoneNumber} ${n.friendlyName ?? ""}`,
        render: (n) => {
          const label = n.friendlyName && n.friendlyName !== formatPhone(n.phoneNumber) && n.friendlyName !== n.phoneNumber ? n.friendlyName : null;
          return (
            <div className="min-w-0">
              <div className="truncate">{formatPhone(n.phoneNumber)}</div>
              {label ? <div className="mt-1 truncate text-xs text-wz-caption">{label}</div> : null}
              {n.technicianLine ? (
                <WzTag className="mt-1">
                  <span className="inline-flex items-center gap-1">
                    <KeyRound className="size-3" aria-hidden /> Technician line
                  </span>
                </WzTag>
              ) : null}
            </div>
          );
        },
      },
      {
        // Workiz's Ad group is our job source: calls through this number are
        // attributed to it, and a job created from such a call carries it.
        id: "source",
        label: "Ad group",
        cellClassName: "overflow-visible whitespace-normal",
        searchText: (n) => sourceName(settingsOf(n.phoneNumber)?.sourceId),
        render: (n) => {
          const sourceId = settingsOf(n.phoneNumber)?.sourceId;
          return (
            <div className="min-w-0">
              <JobSourceSelect
                value={sourceId}
                triggerClassName="h-[38px] w-full"
                onChange={(next) => updateSettings.mutate({ phoneNumber: n.phoneNumber, sourceId: next ?? null })}
                disabled={!canManage}
              />
              {canManage && sourceId ? (
                <RemoveLink
                  label="Remove ad group"
                  onClick={() => updateSettings.mutate({ phoneNumber: n.phoneNumber, sourceId: null })}
                />
              ) : null}
            </div>
          );
        },
      },
      {
        id: "flow",
        label: "Flow",
        cellClassName: "overflow-visible whitespace-normal",
        searchText: (n) => flowOfNumber(flows, n.phoneNumber)?.name,
        sortValue: (n) => flowOfNumber(flows, n.phoneNumber)?.name,
        render: (n) => {
          const flow = flowOfNumber(flows, n.phoneNumber);
          return (
            <div className="min-w-0">
              <NumberFlowSelect
                flows={flows}
                value={flow?.id}
                aria-label={`Flow for ${formatPhone(n.phoneNumber)}`}
                onChange={(toFlowId) => assignFlow.mutate({ number: n.phoneNumber, toFlowId })}
                disabled={!canManage || assignFlow.isPending}
              />
              {canManage && flow ? (
                <RemoveLink label="Remove flow" onClick={() => assignFlow.mutate({ number: n.phoneNumber, toFlowId: null })} />
              ) : null}
            </div>
          );
        },
      },
      {
        // Ours: jobs created from calls on this number start with this
        // company; empty falls back to the call flow's.
        id: "company",
        label: "Company",
        cellClassName: "overflow-visible whitespace-normal",
        render: (n) => (
          <span title="Overrides the call flow's company" className="block min-w-0">
            <BusinessProfileSelect
              className="h-[38px]"
              aria-label={`Company for ${formatPhone(n.phoneNumber)}`}
              value={settingsOf(n.phoneNumber)?.businessProfileId ?? null}
              allowNone
              noneLabel="Call flow's company"
              onChange={(businessProfileId) => updateSettings.mutate({ phoneNumber: n.phoneNumber, businessProfileId })}
              disabled={!canManage}
            />
          </span>
        ),
      },
      {
        id: "created",
        label: "Created",
        width: 250,
        sortValue: (n) => n.dateCreated ?? undefined,
        render: (n) => formatNumberCreated(n.dateCreated),
      },
      {
        id: "action",
        label: "Action",
        width: 130,
        render: (n) =>
          canManage ? (
            <div className="flex items-center gap-1">
              {/* A workspace has exactly one technician line, so this reads as
                  a designation rather than a per-number setting: turning it
                  on elsewhere moves it. */}
              <WzRowIconButton
                label={n.technicianLine ? "Clear technician line" : "Make technician line"}
                disabled={setTechLine.isPending}
                onClick={() => setTechLine.mutate({ sid: n.sid, on: !n.technicianLine })}
                className="h-8 w-[43px] rounded-pill"
              >
                <KeyRound className={cn("size-[18px]", n.technicianLine ? "text-foreground" : "text-wz-outline")} strokeWidth={1.5} />
              </WzRowIconButton>
              <WzRowIconButton label="Release number" onClick={() => setDeleting(n)} className="h-8 w-[43px] rounded-pill">
                <WzTrashIcon size={18} />
              </WzRowIconButton>
            </div>
          ) : null,
      },
    ];
  }, [numberSettings, sources.data, flows, canManage, updateSettings, assignFlow, setTechLine]);

  // Refused only once the permissions say so — not while they are coming.
  if (denied("settings")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view phone numbers.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <WzTabIntro
        action={
          ready && canManage ? (
            <WzButton className="px-8" onClick={() => setBuyOpen(true)}>
              Add number
            </WzButton>
          ) : null
        }
      >
        {NUMBERS_INTRO}
      </WzTabIntro>

      {!ready ? (
        <div className="px-5">
          <Skeleton className="h-[480px] w-full rounded-none" />
        </div>
      ) : (
        <WzLocalGrid<OwnedNumber>
          label="Phone numbers"
          columns={columns}
          rows={numbers ?? []}
          rowKey={(n) => n.sid}
          pagerInside
          emptyText={null}
        />
      )}

      {buyOpen ? <BuyNumberDialog open={buyOpen} onOpenChange={setBuyOpen} /> : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release this number?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? formatPhone(deleting.phoneNumber) : ""} will be permanently released back to Twilio. You can&apos;t
              get the same number back, and inbound/outbound on it will stop immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) release.mutate(deleting.sid, { onSuccess: () => setDeleting(undefined) });
              }}
            >
              {release.isPending ? <Loader2 className="size-4 animate-spin" /> : "Release"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

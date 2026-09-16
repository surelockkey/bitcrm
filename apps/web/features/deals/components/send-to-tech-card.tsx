"use client";

import { useState } from "react";
import { Eye, Loader2, Send } from "lucide-react";
import { SEND_TO_TECH_CHANNELS, type Deal, type SendToTechChannel } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useMessagingSettings } from "@/features/messaging/hooks";
import type { DealAssignment } from "../api";
import { useDealAssignments, useSendToTech, useUserMap } from "../hooks";
import {
  SEND_TO_TECH_CHANNEL_LABEL,
  deliveryReasonLabel,
  formatStamp,
  seenByTechLabel,
  sentToTechLabel,
} from "../lib";

/** What the dialog ticks when the workspace has expressed no preference. */
export const DEFAULT_SEND_TO_TECH_CHANNELS: SendToTechChannel[] = ["sms"];

/**
 * Workiz "Send to tech" on the job page (`WORKIZ_FEATURE_GAPS` §2.1 / §2.5):
 * the channel checkboxes, the button, and the `Sent · 12:10 PM via SMS` /
 * `Seen` stamps underneath it. Pressing again is a resend — Workiz's own
 * behaviour, and the reason the button relabels itself rather than
 * disappearing once a job has gone out.
 *
 * The job is stamped at the click; delivery is asynchronous, so the
 * per-technician lines below fill in as messaging reports each channel back.
 */
export function SendToTechCard({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const { can } = usePermissions();
  // The workspace default lives in messaging settings, which only a
  // settings-viewer may read; everyone else starts from SMS.
  const { data: settings } = useMessagingSettings(can("settings"));
  const send = useSendToTech(deal.id);
  const { data: assignments } = useDealAssignments(deal.id, deal.assignedTechIds.length > 0);

  // `null` = the dispatcher has not touched the boxes, so the workspace default
  // still applies — and keeps applying if the settings arrive after first paint.
  // (Derived, not synced in an effect: no cascading render when they load.)
  const [picked, setPicked] = useState<SendToTechChannel[] | null>(null);
  const preset = settings?.sendToTechChannels;
  const channels = picked ?? (preset?.length ? preset : DEFAULT_SEND_TO_TECH_CHANNELS);

  const toggle = (channel: SendToTechChannel, on: boolean) =>
    setPicked(
      on
        ? SEND_TO_TECH_CHANNELS.filter((c) => c === channel || channels.includes(c))
        : channels.filter((c) => c !== channel),
    );

  const hasRoster = deal.assignedTechIds.length > 0;
  const sent = sentToTechLabel(deal);
  const seen = seenByTechLabel(deal);

  return (
    <div className="space-y-2.5" data-testid="send-to-tech">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {SEND_TO_TECH_CHANNELS.map((channel) => (
          <label
            key={channel}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium",
              canEdit && hasRoster ? "cursor-pointer" : "cursor-not-allowed opacity-60",
            )}
          >
            <Checkbox
              checked={channels.includes(channel)}
              onCheckedChange={(v) => toggle(channel, v === true)}
              disabled={!canEdit || !hasRoster}
              aria-label={SEND_TO_TECH_CHANNEL_LABEL[channel]}
            />
            {SEND_TO_TECH_CHANNEL_LABEL[channel]}
          </label>
        ))}
        <Button
          variant={sent ? "outline" : "brand"}
          size="sm"
          className="ml-auto gap-1.5"
          disabled={!canEdit || !hasRoster || channels.length === 0 || send.isPending}
          onClick={() => send.mutate({ channels })}
        >
          {send.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          {sent ? "Resend" : "Send to tech"}
        </Button>
      </div>

      {!hasRoster ? (
        <p className="text-xs text-muted-foreground">
          Assign a technician before sending the job.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {sent ? (
          <span className="font-medium text-foreground">{sent}</span>
        ) : hasRoster ? (
          <span className="text-muted-foreground">Not sent to the technician yet</span>
        ) : null}
        {seen ? (
          <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
            <Eye className="size-3.5" /> {seen}
          </span>
        ) : sent ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Eye className="size-3.5" /> Not seen yet
          </span>
        ) : null}
      </div>

      {sent && assignments?.length ? (
        <AssignmentLines assignments={assignments} techIds={deal.assignedTechIds} />
      ) : null}
    </div>
  );
}

/**
 * One line per technician: when the job reached them and what each channel
 * did. Only the roster is listed — an `ASSIGN#` row left over from an
 * unassignment is history, not something to explain here.
 */
function AssignmentLines({
  assignments,
  techIds,
}: {
  assignments: DealAssignment[];
  techIds: string[];
}) {
  const { map } = useUserMap(techIds);
  const onRoster = assignments.filter((a) => techIds.includes(a.techId) && a.sentAt);
  if (!onRoster.length) return null;

  return (
    <ul className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
      {onRoster.map((a) => {
        const u = map.get(a.techId);
        const name = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || a.techId : a.techId;
        return (
          <li key={a.techId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium text-foreground">{name}</span>
            {(a.sentVia ?? []).map((channel) => {
              const delivery = a.deliveries?.[channel];
              const label = SEND_TO_TECH_CHANNEL_LABEL[channel];
              if (!delivery) return <span key={channel}>{label} · sending…</span>;
              if (delivery.status === "sent") return <span key={channel}>{label} · sent</span>;
              return (
                <span key={channel} className="text-amber-700 dark:text-amber-400">
                  {label} · {delivery.status === "failed" ? "failed" : "skipped"}:{" "}
                  {deliveryReasonLabel(delivery.reason)}
                </span>
              );
            })}
            {a.seenAt ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <Eye className="size-3" /> seen {formatStamp(a.seenAt)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

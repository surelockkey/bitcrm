"use client";

import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  EllipsisVertical,
  ExternalLink,
  FilePlus2,
  MailOpen,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/features/auth/use-permissions";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import type { InboxConversation } from "../api";
import { useUpdateConversation } from "../hooks";
import { KIND_TAG, partyHref } from "../lib";
import { AssignSubmenu } from "./assign-menu";
import { WzPersonIcon, WzPhoneIcon, WzStarIcon } from "./inbox-icons";

/** Where "Create job" goes: the New Job page, seeded with the party. */
export function createJobHref(c: InboxConversation): string | undefined {
  if (c.partyKind === "contact" && c.partyId) return `/deals/new?contactId=${encodeURIComponent(c.partyId)}`;
  const phone = c.addresses?.phones?.[0];
  if (c.kind === "unknown" && phone) return `/deals/new?phone=${encodeURIComponent(phone)}`;
  return undefined;
}

/** Workiz's tertiary icon buttons in the thread bar: 40×40, r8, a 24px ink glyph, #f3f6f7 under the pointer. */
const headerIcon =
  "grid size-10 place-items-center rounded-[8px] text-foreground transition-colors hover:bg-wz-secondary-hover data-[state=open]:bg-wz-secondary-hover";

/**
 * The thread's title bar, as Workiz draws it (pg_messages_wz_07_thread_client):
 * 58px, white, ruled #ccc underneath, 16px in; the name 14px/21px 600 (a link
 * to the record) over the type 12px/18px #768287; 16px on, a 1×30 #bfc4c7
 * divider; then "Client info" (the person) and the call handset, 16px apart.
 * Workiz stops there. Ours adds "⋮" at the far right for what the inbox can
 * also do to a thread — assign, star, mark unread, archive, open the record,
 * create a job.
 */
export function ThreadHeader({
  conversation: c,
  title,
  canManage,
  onBack,
  onToggleInfo,
  className,
}: {
  conversation: InboxConversation;
  title: string;
  canManage: boolean;
  /** Narrow layout: return to the list. */
  onBack?: () => void;
  /** Opens the party's card (the person icon). */
  onToggleInfo?: () => void;
  className?: string;
}) {
  const { can } = usePermissions();
  const update = useUpdateConversation();
  const href = partyHref(c);
  const phone = c.addresses?.phones?.[0];
  const archived = c.state === "archived";
  const jobHref = can("deals", "create") ? createJobHref(c) : undefined;
  const infoLabel = c.partyKind === "user" ? "Profile" : "Client info";

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"], label: string) =>
    update.mutate({ id: c.id, patch: p, label });

  return (
    <div
      className={cn(
        "flex h-[58px] shrink-0 items-center gap-4 border-b border-input bg-background px-4",
        className,
      )}
    >
      {onBack ? (
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to conversations" className="-ml-2 md:hidden">
          <ChevronLeft className="size-4" />
        </Button>
      ) : null}

      <div className="min-w-0">
        <h2 className="truncate text-[14px] leading-[21px] font-semibold text-foreground">
          {href ? (
            <Link href={href} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
          {c.flagged ? (
            <span role="img" aria-label="Starred" className="ml-1.5 inline-block align-[-1px]">
              <WzStarIcon tone="incoming" starred size={12} />
            </span>
          ) : null}
        </h2>
        <div className="truncate text-[12px] leading-[18px] text-wz-outline-label">
          {KIND_TAG[c.kind]}
          {archived ? " · Archived" : ""}
        </div>
      </div>

      <span aria-hidden className="h-[30px] w-px shrink-0 bg-wz-outline-disabled" />

      <div className="flex items-center gap-4">
        {/* The person icon: the party's card as a side sheet in the inbox, their record elsewhere. */}
        {onToggleInfo || href ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {onToggleInfo ? (
                <button type="button" onClick={onToggleInfo} aria-label="Contact card" className={headerIcon}>
                  <WzPersonIcon />
                </button>
              ) : (
                <Link href={href as string} aria-label="Contact card" className={headerIcon}>
                  <WzPersonIcon />
                </Link>
              )}
            </TooltipTrigger>
            <TooltipContent>{infoLabel}</TooltipContent>
          </Tooltip>
        ) : null}
        {phone && (c.partyKind === "contact" || c.partyKind === "company") ? (
          // BitCRM's own telephony: the caller-id picker, then the softphone.
          <CallClientButton to={phone} partyId={c.partyId} kind={c.partyKind} variant="workiz" />
        ) : phone ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <a href={`tel:${phone}`} aria-label={`Call ${formatPhone(phone)}`} className={headerIcon}>
                <WzPhoneIcon />
              </a>
            </TooltipTrigger>
            <TooltipContent>Call {title || formatPhone(phone)}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <span className="flex-1" />

      {canManage || href || jobHref ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More actions" className={headerIcon}>
              <EllipsisVertical className="size-6" strokeWidth={1.5} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {href ? (
              <DropdownMenuItem asChild>
                <Link href={href}>
                  <ExternalLink className="size-4" /> Open {c.partyKind === "user" ? "profile" : "record"}
                </Link>
              </DropdownMenuItem>
            ) : null}
            {jobHref ? (
              <DropdownMenuItem asChild>
                <Link href={jobHref}>
                  <FilePlus2 className="size-4" /> Create job from this conversation
                </Link>
              </DropdownMenuItem>
            ) : null}
            {canManage ? (
              <>
                {href || jobHref ? <DropdownMenuSeparator /> : null}
                <AssignSubmenu conversation={c} />
                <DropdownMenuItem
                  disabled={update.isPending}
                  onSelect={() => patch({ flagged: !c.flagged }, c.flagged ? "Star removed" : "Conversation starred")}
                >
                  <Star className={cn("size-4", c.flagged && "fill-current text-primary")} />
                  {c.flagged ? "Unstar" : "Star"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={update.isPending}
                  onSelect={() => patch({ unread: !c.unread }, c.unread ? "Marked read" : "Marked unread")}
                >
                  <MailOpen className="size-4" /> {c.unread ? "Mark as read" : "Mark as unread"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={update.isPending}
                  onSelect={() =>
                    patch(
                      { state: archived ? "open" : "archived" },
                      archived ? "Conversation restored" : "Conversation archived",
                    )
                  }
                >
                  {archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                  {archived ? "Restore" : "Archive"}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

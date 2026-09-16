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
  Phone,
  Star,
  UserRound,
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

/** Where "Create job" goes: the New Job page, seeded with the party. */
export function createJobHref(c: InboxConversation): string | undefined {
  if (c.partyKind === "contact" && c.partyId) return `/deals/new?contactId=${encodeURIComponent(c.partyId)}`;
  const phone = c.addresses?.phones?.[0];
  if (c.kind === "unknown" && phone) return `/deals/new?phone=${encodeURIComponent(phone)}`;
  return undefined;
}

const headerIcon =
  "grid size-9 place-items-center rounded-md text-foreground/80 transition-colors hover:bg-muted hover:text-foreground";

/**
 * The thread's title bar, as in Workiz: the name (a link to the record)
 * with the type under it, a thin divider, then two icon buttons — the
 * person (the client's card) and the phone (a call). Everything else the
 * inbox can do to a thread — assign, star, mark unread, archive, open the
 * record, create a job — sits behind "⋮" at the far right.
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

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"], label: string) =>
    update.mutate({ id: c.id, patch: p, label });

  return (
    <div className={cn("flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4", className)}>
      {onBack ? (
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to conversations" className="-ml-2 md:hidden">
          <ChevronLeft className="size-4" />
        </Button>
      ) : null}

      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold leading-5">
          {href ? (
            <Link href={href} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
          {c.flagged ? (
            <Star className="ml-1.5 inline size-3.5 fill-current text-amber-500 align-[-2px]" aria-label="Starred" />
          ) : null}
        </h2>
        <div className="truncate text-xs text-muted-foreground">
          {KIND_TAG[c.kind]}
          {archived ? " · Archived" : ""}
        </div>
      </div>

      <span aria-hidden className="mx-2 h-8 w-px shrink-0 bg-border" />

      <div className="flex items-center gap-1">
        {/* The person icon: the party's card as a side sheet in the inbox, their record elsewhere. */}
        {onToggleInfo || href ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {onToggleInfo ? (
                <button type="button" onClick={onToggleInfo} aria-label="Contact card" className={headerIcon}>
                  <UserRound className="size-5" />
                </button>
              ) : (
                <Link href={href as string} aria-label="Contact card" className={headerIcon}>
                  <UserRound className="size-5" />
                </Link>
              )}
            </TooltipTrigger>
            <TooltipContent>{c.partyKind === "user" ? "Profile" : "Client card"}</TooltipContent>
          </Tooltip>
        ) : null}
        {phone && (c.partyKind === "contact" || c.partyKind === "company") ? (
          // BitCRM's own telephony: the caller-id picker, then the softphone.
          <CallClientButton
            to={phone}
            partyId={c.partyId}
            kind={c.partyKind}
            className="[&>button]:size-9 [&>button]:text-foreground/80 [&_svg]:size-5"
          />
        ) : phone ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <a href={`tel:${phone}`} aria-label={`Call ${formatPhone(phone)}`} className={headerIcon}>
                <Phone className="size-5" />
              </a>
            </TooltipTrigger>
            <TooltipContent>Call {formatPhone(phone)}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <span className="flex-1" />

      {canManage || href || jobHref ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More actions" className={headerIcon}>
              <EllipsisVertical className="size-5" />
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
                  <Star className={cn("size-4", c.flagged && "fill-current text-amber-500")} />
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

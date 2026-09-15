"use client";

import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  Briefcase,
  FilePlus2,
  ChevronLeft,
  ExternalLink,
  Info,
  MailOpen,
  MoreHorizontal,
  Star,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { usePermissions } from "@/features/auth/use-permissions";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import type { InboxConversation } from "../api";
import { useUpdateConversation } from "../hooks";
import { conversationAddress, initialsOf, KIND_LABEL, partyHref } from "../lib";
import { AssignMenu } from "./assign-menu";

/** Where "Create job" goes: the New Job page, seeded with the party. */
export function createJobHref(c: InboxConversation): string | undefined {
  if (c.partyKind === "contact" && c.partyId) return `/deals/new?contactId=${encodeURIComponent(c.partyId)}`;
  const phone = c.addresses?.phones?.[0];
  if (c.kind === "unknown" && phone) return `/deals/new?phone=${encodeURIComponent(phone)}`;
  return undefined;
}

/**
 * The thread's title bar, Workiz-style: who, how to reach them, the job
 * the thread is about, and the actions — call, assign, star, archive,
 * mark unread, open the record, create a job from the conversation.
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
  /** Narrow layout: open the party card. */
  onToggleInfo?: () => void;
  className?: string;
}) {
  const { can } = usePermissions();
  const update = useUpdateConversation();
  const href = partyHref(c);
  const address = conversationAddress(c);
  const email = c.addresses?.emails?.[0];
  const phone = c.addresses?.phones?.[0];
  const archived = c.state === "archived";
  const jobHref = can("deals", "create") ? createJobHref(c) : undefined;

  const patch = (p: Parameters<typeof update.mutate>[0]["patch"], label: string) =>
    update.mutate({ id: c.id, patch: p, label });

  const subtitle = [
    KIND_LABEL[c.kind],
    address ?? (c.phonesMasked ? "Number hidden" : undefined),
    address && email && !address.includes("@") ? email : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("flex items-center gap-2 border-b px-3 py-2", className)}>
      {onBack ? (
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to conversations" className="md:hidden">
          <ChevronLeft className="size-4" />
        </Button>
      ) : null}
      <Avatar size="sm">
        <AvatarFallback className="text-[10px] font-semibold">{initialsOf(title)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {c.flagged ? <Star className="size-3.5 shrink-0 fill-current text-amber-500" aria-label="Starred" /> : null}
          {archived ? (
            <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Archived
            </span>
          ) : null}
          {c.lastDealId ? (
            <Link
              href={`/deals/${c.lastDealId}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Briefcase className="size-2.5" /> Job
            </Link>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>

      <div className="flex items-center gap-1">
        {phone && (c.partyKind === "contact" || c.partyKind === "company") ? (
          <CallClientButton to={phone} partyId={c.partyId} kind={c.partyKind} />
        ) : null}
        {canManage ? <AssignMenu conversation={c} /> : null}
        {canManage ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={c.flagged ? "Unstar conversation" : "Star conversation"}
                aria-pressed={c.flagged}
                disabled={update.isPending}
                onClick={() => patch({ flagged: !c.flagged }, c.flagged ? "Star removed" : "Conversation starred")}
              >
                <Star className={cn("size-4", c.flagged && "fill-current text-amber-500")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{c.flagged ? "Unstar" : "Star"}</TooltipContent>
          </Tooltip>
        ) : null}
        {onToggleInfo ? (
          <Button variant="ghost" size="icon-sm" onClick={onToggleInfo} aria-label="Details" className="xl:hidden">
            <Info className="size-4" />
          </Button>
        ) : null}
        {canManage || href || jobHref ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
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
                  <DropdownMenuItem
                    onSelect={() => patch({ unread: !c.unread }, c.unread ? "Marked read" : "Marked unread")}
                  >
                    <MailOpen className="size-4" /> {c.unread ? "Mark as read" : "Mark as unread"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
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
    </div>
  );
}

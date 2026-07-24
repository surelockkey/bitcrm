import { Globe, Mail, Phone, PencilLine, Crown } from "lucide-react";
import { ClientType, ContactSource, ContactType } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { clientTypeLabel, contactTypeLabel, sourceLabel, type CoiStatus } from "../lib";

export function ClientTypeBadge({ type }: { type: ClientType }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal",
        type === ClientType.GOVERNMENT && "border-amber-500/40 text-amber-700 dark:text-amber-500",
        type === ClientType.COMMERCIAL && "border-primary/30 text-primary",
      )}
    >
      {clientTypeLabel(type)}
    </Badge>
  );
}

export function ContactTypeBadge({ type }: { type: ContactType }) {
  return (
    <Badge
      variant={type === ContactType.COMPANY_REPRESENTATIVE ? "secondary" : "outline"}
      className="font-normal"
    >
      {contactTypeLabel(type)}
    </Badge>
  );
}

const SOURCE_ICON = {
  [ContactSource.PHONE_CALL]: Phone,
  [ContactSource.EMAIL]: Mail,
  [ContactSource.WEB_FORM]: Globe,
  [ContactSource.MANUAL]: PencilLine,
} as const;

export function SourceLabel({ source }: { source: ContactSource }) {
  const Icon = SOURCE_ICON[source];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3" />
      {sourceLabel(source)}
    </span>
  );
}

export function StatusDot({ active = true, label }: { active?: boolean; label?: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", active ? "bg-green-500" : "bg-muted-foreground/50")} />
      {label ?? (active ? "Active" : "Deleted")}
    </Badge>
  );
}

export function PlatinumBadge() {
  return (
    <Badge variant="outline" className="gap-1 border-violet-500/40 font-normal text-violet-700 dark:text-violet-400">
      <Crown className="size-3" />
      Platinum
    </Badge>
  );
}

const COI_STYLE: Record<Exclude<CoiStatus, "none">, { label: string; cls: string }> = {
  valid: { label: "COI valid", cls: "border-green-500/40 text-green-700 dark:text-green-500" },
  expiring: { label: "COI expiring", cls: "border-amber-500/40 text-amber-700 dark:text-amber-500" },
  expired: { label: "COI expired", cls: "border-destructive/40 text-destructive" },
};

export function CoiStatusBadge({ status }: { status: CoiStatus }) {
  if (status === "none") return null;
  const s = COI_STYLE[status];
  return <Badge variant="outline" className={cn("font-normal", s.cls)}>{s.label}</Badge>;
}

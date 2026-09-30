import { Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { sentLabel } from "../lib";

/** "Unsent" / "Sent Sep 1, 2026" — shared by invoices and estimates. */
export function SentBadge({ sentAt, className }: { sentAt?: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      title={sentAt ? new Date(sentAt).toLocaleString() : "Not sent to the client yet"}
      className={cn(
        "font-normal",
        sentAt ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "text-muted-foreground",
        className,
      )}
    >
      {sentAt ? <Send /> : null}
      {sentLabel(sentAt)}
    </Badge>
  );
}

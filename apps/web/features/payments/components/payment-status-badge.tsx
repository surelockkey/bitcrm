import type { PaymentStatus } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PAYMENT_STATUS_META } from "../lib";

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: PaymentStatus;
  className?: string;
}) {
  const meta = PAYMENT_STATUS_META[status] ?? PAYMENT_STATUS_META.pending;
  return (
    <Badge variant="outline" className={cn("font-medium", meta.className, className)}>
      {meta.label}
    </Badge>
  );
}

/** "Partially paid" — Workiz keeps the invoice due and says so beside it. */
export function PartiallyPaidBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        className,
      )}
    >
      Partially paid
    </Badge>
  );
}

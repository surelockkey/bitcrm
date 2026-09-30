import type { InvoiceStatus } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { INVOICE_STATUS_META } from "../lib";

export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const meta = INVOICE_STATUS_META[status] ?? INVOICE_STATUS_META.no_amount;
  return (
    <Badge variant="outline" className={cn("font-medium", meta.className, className)}>
      {meta.label}
    </Badge>
  );
}

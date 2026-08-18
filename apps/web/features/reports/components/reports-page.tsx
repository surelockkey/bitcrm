"use client";

import {
  Banknote,
  BarChart3,
  Barcode,
  Briefcase,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  Cog,
  CreditCard,
  Package,
  Paperclip,
  Percent,
  Phone,
  Receipt,
  ReceiptText,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { usePermissions } from "@/features/auth/use-permissions";

/** The Workiz reports catalog, in its on-screen order. All mocked for now. */
export const REPORT_TILES: { name: string; icon: LucideIcon }[] = [
  { name: "Jobs", icon: Briefcase },
  { name: "Tips", icon: Wallet },
  { name: "Job Statistics", icon: BarChart3 },
  { name: "Leads Report", icon: Banknote },
  { name: "Payments", icon: CreditCard },
  { name: "Expenses", icon: CircleDollarSign },
  { name: "Estimates", icon: Paperclip },
  { name: "Invoices", icon: Receipt },
  { name: "Aging invoices", icon: ReceiptText },
  { name: "Timesheets", icon: Clock },
  { name: "Items and services", icon: Barcode },
  { name: "Tax", icon: Percent },
  { name: "Call Tracking", icon: Phone },
  { name: "Inventory Usage", icon: Package },
  { name: "Franchise Report", icon: Building2 },
  { name: "Tasks", icon: ClipboardCheck },
  { name: "Equipment", icon: Cog },
  { name: "Service Plans", icon: CalendarCheck },
];

/**
 * Workiz-style reports hub: one tile per report. The reports themselves are
 * being built — every tile is mocked and says so when clicked.
 */
export function ReportsPage() {
  const { can } = usePermissions();
  if (!can("reports", "view")) return <NoAccess entity="reports" />;

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Job, billing and team reports. The reports are being built — tiles are placeholders for now.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
        {REPORT_TILES.map(({ name, icon: Icon }) => (
          <button
            key={name}
            type="button"
            onClick={() =>
              toast.info(`The ${name} report is on the way — reports are in progress.`)
            }
            className="flex items-center justify-between rounded-lg border border-l-4 border-l-foreground/70 bg-card px-4 py-3.5 text-left shadow-xs transition-colors hover:bg-muted/40"
          >
            <span className="text-sm font-medium">{name}</span>
            <Icon className="size-5 text-muted-foreground" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

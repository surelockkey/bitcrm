"use client";

import Link from "next/link";
import {
  Activity,
  BarChart3,
  Barcode,
  Briefcase,
  Building2,
  Calculator,
  CreditCard,
  Globe,
  Package,
  Paperclip,
  Percent,
  Phone,
  Receipt,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { usePermissions } from "@/features/auth/use-permissions";

/**
 * The Workiz reports this business keeps, in Workiz's on-screen order
 * (Performance Pay, Sales, Tips, Leads, Expenses, Timesheets, Tasks,
 * Equipment and Service Plans are not used here). `href` = built.
 */
export const REPORT_TILES: { name: string; icon: LucideIcon; href?: string }[] = [
  { name: "Jobs", icon: Briefcase, href: "/reports/jobs" },
  { name: "Job Statistics", icon: BarChart3, href: "/reports/job-statistics" },
  { name: "Payments", icon: CreditCard },
  { name: "Activity", icon: Activity },
  // Workiz opens these two on the pages of the same name.
  { name: "Estimates", icon: Paperclip, href: "/estimates" },
  { name: "Invoices", icon: Receipt, href: "/invoices" },
  { name: "Aging invoices", icon: ReceiptText },
  { name: "Items and services", icon: Barcode },
  { name: "Website requests", icon: Globe },
  { name: "Tax", icon: Percent },
  { name: "Call Tracking", icon: Phone },
  { name: "Inventory Usage", icon: Package },
  { name: "Franchise Report", icon: Building2 },
  { name: "Commissions (Legacy)", icon: Calculator },
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
        {REPORT_TILES.map(({ name, icon: Icon, href }) => {
          const inner = (
            <>
              <span className="text-sm font-medium">{name}</span>
              <Icon className="size-5 text-muted-foreground" aria-hidden />
            </>
          );
          const tileClass =
            "flex items-center justify-between rounded-lg border border-l-4 border-l-foreground/70 bg-card px-4 py-3.5 text-left shadow-xs transition-colors hover:bg-muted/40";
          return href ? (
            <Link key={name} href={href} className={tileClass}>
              {inner}
            </Link>
          ) : (
            <button
              key={name}
              type="button"
              onClick={() =>
                toast.info(`The ${name} report is on the way — reports are in progress.`)
              }
              className={tileClass}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}

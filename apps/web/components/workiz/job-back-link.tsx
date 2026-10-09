import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * "← Job ID: …" — the line over a job's document that goes back to the job:
 * the estimate's (pg_estimate_wz_01_job, estimatesHeader-module link: "Job
 * ID:JTX319" at (220,118) on white) and the invoice's (pg_invoice_wz_01_partial,
 * header-module__jobLink: "Job ID: XYB3JT" at (220,114) in the grey header).
 * Both are 14px/16px ink; the words are the caller's, as each page words them.
 * Not a page-header "‹ Parent" link: Workiz draws this one on the document.
 */
export function WzJobBackLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("flex w-fit items-center gap-2.5 text-[14px] leading-4 text-foreground hover:underline", className)}>
      <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
      {children}
    </Link>
  );
}

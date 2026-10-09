import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Workiz's explanation band over a section (`Explain-module`, the Price book
 * page — pg_pricebook_wz_01_default; the settings pages' "Job Types — Add
 * your job types…" band is the same module): a 120px #fafcfc band across the
 * page; the h1 (31px/40px 500 ink) 22px in, a 1px #bfc4c7 rule three
 * quarters of the band tall 54px after it, then 30px on the words that say
 * what the page is for (16px/24px ink, 0.2px tracking), 597px wide as
 * Workiz's column leaves them — two lines for the price book's sentence.
 *
 * Workiz puts help-centre links and a video card at the right; those are
 * Workiz's own, so there is no slot for them.
 */
export function WzExplainHeader({
  title,
  children,
  className,
}: {
  title: string;
  /** The sentence under the rule. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="wz-explain-header" className={cn("flex h-[120px] shrink-0 items-center bg-wz-band", className)}>
      <div className="mr-[15px] pr-10 pl-[22px] whitespace-nowrap">
        <h1 className="text-[31px] leading-10 font-medium tracking-[0.4px] text-foreground">{title}</h1>
      </div>
      <div data-slot="wz-explain-rule" aria-hidden className="mr-[30px] ml-[54px] h-3/4 border-r border-wz-outline-disabled" />
      <p className="max-w-[597px] min-w-0 text-base leading-6 tracking-[0.2px] text-foreground">{children}</p>
    </div>
  );
}

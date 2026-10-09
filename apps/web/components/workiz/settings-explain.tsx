import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The band over Workiz's settings lists — the legacy `react_components_explain`
 * of Team, Job Types, Service Areas and Taxes (pg_technicians_wz_01_team,
 * uikit_wz_set_jobtypes / _servicearea / _taxes). Not the Price book's newer
 * `Explain-module` (31px h1, no icon — `WzExplainHeader` on that branch).
 *
 * Measured on Team (pg_technicians_wz_measure_team.json):
 *   band   #fafcfc across the page, 30px 10px, 109px with a one-line text;
 *   title  30px in, a 28px ink glyph, the h2 30px after it — 22.4px/26.88px
 *          600 #404040 — the block 40px short of a 1px #ddd rule that runs
 *          its height (the h2's 22px foot margin sets that height: 49px);
 *   words  30px past the rule: 14px/22.4px #404040; links 8px under them,
 *          14px #3da6e1 ("Read guide ↗" — Workiz's own help, so `links` is
 *          for the caller's, and nothing is drawn without them).
 */
export function WzSettingsExplain({
  icon,
  title,
  children,
  links,
  className,
}: {
  /** The page's glyph, drawn 28px in ink. */
  icon?: ReactNode;
  title: string;
  /** What the page is for. */
  children: ReactNode;
  /** Under the words (Workiz's "Read guide"). */
  links?: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="wz-settings-explain" className={cn("flex shrink-0 bg-wz-band px-2.5 py-[30px] text-wz-strong", className)}>
      <div data-slot="wz-settings-explain-title" className="flex shrink-0 border-r border-wz-frame pr-10 pl-[30px]">
        {icon ? (
          <div aria-hidden className="flex h-7 w-7 items-center justify-center text-wz-strong [&_svg]:size-7 [&_svg]:stroke-[1.25]">
            {icon}
          </div>
        ) : null}
        <h2 className={cn("mb-[22px] text-[22.4px] leading-[26.88px] font-semibold tracking-[0.4px] whitespace-nowrap", icon && "ml-[30px]")}>
          {title}
        </h2>
      </div>
      <div className="flex min-w-0 flex-col px-[30px]">
        <p className="text-sm leading-[22.4px] tracking-[0.4px]">{children}</p>
        {links ? (
          <div data-slot="wz-settings-explain-links" className="mt-2 flex gap-4 text-sm leading-4 text-[#3da6e1]">
            {links}
          </div>
        ) : null}
      </div>
    </div>
  );
}

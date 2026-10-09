import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { WzInfoTip } from "./form-section-title";

/*
 * Workiz's newer settings pages that have no grey band — Security Center
 * (`feat_security_wz_security`), Estimates settings
 * (`settings_audit_wz_estimates_settings_v3`): a plain title 40px in,
 * 39px under the history strip, then sections over #dfe2e3 rules.
 */

/**
 * The page's title ("Security center ⓘ"): 25px/37px 500 #404040, Workiz's
 * `secuirtySettings-module__title`, with an optional ⓘ right after the words
 * (20px, the same ink). The page puts 40px to its left (`pl-10`) and 39px
 * above it; `className` adds the rest.
 */
export function WzSettingsTitle({
  children,
  tip,
  className,
}: {
  children: string;
  /** The ⓘ's words. */
  tip?: ReactNode;
  className?: string;
}) {
  // The ⓘ stands beside the heading, not in it, so the heading's name is the words alone.
  return (
    <div data-slot="wz-settings-title" className={cn("flex items-center text-wz-strong", className)}>
      <h1 className="text-[25px] leading-[37px] font-medium tracking-[0.4px]">{children}</h1>
      {tip ? <WzInfoTip label={children} text={tip} className="[&_svg]:size-5" /> : null}
    </div>
  );
}

/**
 * A section of such a page ("Two-factor authentication (2FA)", "Support PIN
 * code"): the 1px #dfe2e3 rule over it (`rule`, 868px — Workiz's runs from
 * the content's edge, past the title's 40px inset), the subtitle 24px under
 * it (16px/24px 600 #3b4b52, `secuirtySettings-module__subtitle`), the
 * description right under (14px/21px #566d76, `__description`), and the
 * rows 44px under that.
 */
export function WzSettingsSection({
  title,
  description,
  rule = true,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  /** The rule over the section; the first section under the title has one too. */
  rule?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section data-slot="wz-settings-section" aria-label={title} className={cn("flex flex-col", className)}>
      {rule ? <hr className="w-[868px] max-w-full border-0 border-t border-border" aria-hidden /> : null}
      <div className={cn("pl-10", rule && "pt-6")}>
        <h2 className="text-base leading-6 font-semibold tracking-[0.4px] text-foreground">{title}</h2>
        {description ? <p className="text-sm leading-[21px] tracking-[0.4px] text-wz-slate">{description}</p> : null}
        {children ? <div className="mt-11 flex flex-col gap-3">{children}</div> : null}
      </div>
    </section>
  );
}

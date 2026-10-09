"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/*
 * The frame of Workiz's Automation Center (`automationCenterModal-module`,
 * pg_automations_wz_02_center / _10_mine): a 214px column on the left — the
 * AUTOMATION CENTER tile, the lists that filter what is shown, one blue
 * action link at the foot — a 1px #dfe2e3 rule, and the content: the `_tabs`
 * strip, the actions row (search left, buttons right) and what scrolls under
 * them. Workiz opens it as a 1344×900 modal over whatever page you were on;
 * here it is the page itself, so it has no ×.
 *
 * Every number is the capture's: the left column 24px in, its rows 150px; the
 * rule 30px left of the content, from 90px down; the tabs 10px into the
 * content and 14px under its top; the actions 39px under the tabs' rule and
 * 32px over the content.
 */

/** Workiz's `automationCenter.svg`: a #e5f7ff 44px tile with the blue bolt. */
export function AutomationCenterMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} width="44" height="44" viewBox="0 0 44 44" fill="none">
      <rect width="44" height="44" rx="12" fill="#E5F7FF" />
      <path
        d="M16.0151 20.8622L25.3117 12.603L22.6384 20.0243C22.5985 20.2238 22.5985 20.4233 22.7182 20.6228C22.8379 20.7824 23.0374 20.8622 23.2768 20.8622H28.0248L18.6484 29.1613L21.3217 21.74C21.3616 21.5405 21.3616 21.341 21.2419 21.1415C21.1222 20.9819 20.9227 20.8622 20.7232 20.8622H16.0151Z"
        fill="url(#automation-center-mark)"
      />
      <path
        d="M25.2718 10.9272C25.4713 10.7676 25.7107 10.6479 25.9501 10.6479C26.6283 10.6479 27.1071 11.3661 26.8677 12.0045L24.1546 19.5854H28.5834C29.142 19.5854 29.6607 20.1041 29.6607 20.6627C29.6607 20.9819 29.5011 21.3011 29.2617 21.5006L18.6883 30.8371C18.4888 30.9967 18.2494 31.0765 18.01 31.0765C17.3318 31.0765 16.853 30.3982 17.0924 29.7598L19.8055 22.139H15.3368C14.7782 22.139 14.3393 21.7001 14.3393 21.1415C14.3393 20.8223 14.459 20.543 14.6585 20.3435L25.2718 10.9272ZM25.3117 12.603L16.0151 20.8622H20.7232C20.9227 20.8622 21.1222 20.9819 21.2419 21.1415C21.3616 21.341 21.3616 21.5405 21.3217 21.74L18.6484 29.1613L28.0248 20.8622H23.2768C23.0374 20.8622 22.8379 20.7824 22.7182 20.6228C22.5985 20.4233 22.5985 20.2238 22.6384 20.0243L25.3117 12.603Z"
        fill="#3589E9"
      />
      <defs>
        <linearGradient id="automation-center-mark" x1="19.6429" y1="10.5229" x2="19.6429" y2="28.7627" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E5F7FF" />
          <stop offset="1" stopColor="#A2D1FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** The three views of the Center. Discover and My Automations are Workiz's; Activity is ours. */
export type CenterView = "discover" | "mine" | "activity";

const TAB_LABEL: Record<CenterView, string> = {
  discover: "Discover",
  mine: "My Automations",
  activity: "Activity",
};

const TAB_HREF: Record<CenterView, string> = {
  discover: "/automations?view=discover",
  mine: "/automations?view=mine",
  activity: "/automations/activity",
};

/**
 * Workiz's `_tabs` (LegacyTabs): 16px/16px, 15px 25px, 500 idle and 600 when
 * open on white over a 4px #3e4b51 bar (4px corners) laid on the 1px #ccc
 * rule; 4px of the strip above the words.
 */
const TAB =
  "relative shrink-0 cursor-pointer px-[25px] py-[15px] text-base leading-4 whitespace-nowrap text-wz-strong outline-none focus-visible:ring-2 focus-visible:ring-wz-focus";
const TAB_ON = "bg-white font-semibold after:absolute after:inset-x-0 after:-bottom-px after:h-1 after:rounded-[4px] after:bg-wz-tab-bar";
const TAB_OFF = "font-medium hover:text-foreground";

/**
 * The tab strip. On the Center page Discover and My Automations are tabs of
 * one page (`onSelect`), and Activity — a page of its own — is a link at the
 * end of the same strip; on the Activity page all three are links.
 */
export function CenterTabs({
  active,
  onSelect,
  className,
}: {
  active: CenterView;
  /** Given on the Center page: Discover / My Automations switch in place. */
  onSelect?: (view: "discover" | "mine") => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const inPage = (["discover", "mine"] as const);

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onSelect) return;
    const at = inPage.indexOf(active as "discover" | "mine");
    let next: number | undefined;
    if (e.key === "ArrowRight" || e.key === "End") next = e.key === "End" ? 1 : (at + 1) % 2;
    else if (e.key === "ArrowLeft" || e.key === "Home") next = e.key === "Home" ? 0 : (at + 1) % 2;
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onSelect(inPage[next]);
  };

  const activity = (
    <Link
      href={TAB_HREF.activity}
      aria-current={active === "activity" ? "page" : undefined}
      className={cn(TAB, active === "activity" ? TAB_ON : TAB_OFF)}
    >
      {TAB_LABEL.activity}
    </Link>
  );

  return (
    <div className={cn("flex shrink-0 border-b border-input pt-1", className)}>
      {onSelect ? (
        <>
          <div role="tablist" aria-label="Automation center" className="flex" onKeyDown={move}>
            {inPage.map((view, i) => {
              const on = view === active;
              return (
                <button
                  key={view}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => onSelect(view)}
                  className={cn(TAB, on ? TAB_ON : TAB_OFF)}
                >
                  {TAB_LABEL[view]}
                </button>
              );
            })}
          </div>
          {activity}
        </>
      ) : (
        <nav aria-label="Automation center" className="flex">
          {inPage.map((view) => (
            <Link key={view} href={TAB_HREF[view]} className={cn(TAB, TAB_OFF)}>
              {TAB_LABEL[view]}
            </Link>
          ))}
          {activity}
        </nav>
      )}
    </div>
  );
}

/**
 * The page: the left column, the rule, and the content column with its tabs,
 * actions and scrolling body. `hidden` keeps the tabs and actions in place but
 * unseen while the page's data are still on their way (one load per page).
 */
export function CenterFrame({
  side,
  foot,
  tabs,
  actions,
  children,
  waiting = false,
}: {
  side?: ReactNode;
  foot?: ReactNode;
  tabs: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  waiting?: boolean;
}) {
  return (
    <div data-slot="automation-center" className="flex min-h-0 flex-1 bg-background">
      {/* leftSide: 24px in, the 150px rows, 40px before the rule. */}
      <aside className="flex w-[214px] shrink-0 flex-col justify-between overflow-y-auto pt-6 pr-10 pb-10 pl-6">
        <div>
          <div className="mb-[42px] flex items-center gap-3">
            <AutomationCenterMark className="size-11 shrink-0" />
            <span className="w-[84px] text-xs leading-[18px] font-medium tracking-[0.4px] text-foreground uppercase">
              Automation center
            </span>
          </div>
          <div className={cn(waiting && "invisible")}>{side}</div>
        </div>
        {foot ? <div className={cn(waiting && "invisible")}>{foot}</div> : null}
      </aside>

      <div className="relative ml-[30px] flex min-w-0 flex-1 flex-col pt-[14px] pr-6 before:absolute before:top-[90px] before:bottom-0 before:-left-[30px] before:border-l before:border-border">
        <div className={cn("ml-[10px]", waiting && "invisible")}>{tabs}</div>
        <div
          className={cn(
            "mt-[39px] mb-8 ml-[10px] flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5",
            waiting && "invisible",
          )}
        >
          {actions}
        </div>
        <div className="-mr-6 min-h-0 flex-1 overflow-y-auto pr-[14px] pb-[25px] pl-[10px]">{children}</div>
      </div>
    </div>
  );
}

/** A heading in the left column: "Categories", "My Automations" (14px/21px 600). */
export function CenterSideTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="text-sm leading-[21px] font-semibold tracking-[0.4px] text-foreground">
      {children}
    </p>
  );
}

/**
 * A row of the left column. `variant="category"` is Discover's
 * `categoryMenuItem` (36px: 8px 6.5px, a 20px glyph 8px before 13px/19px
 * words); `variant="summary"` is My Automations' row (32px: 6.5px 8px, the
 * name left, the count #768287 right). Hovered and chosen: #f3f6f7, 4px corners.
 */
export function CenterNavRow({
  label,
  count,
  icon,
  selected,
  onSelect,
  variant = "summary",
  controls,
}: {
  label: string;
  count?: number;
  icon?: ReactNode;
  selected?: boolean;
  onSelect: () => void;
  variant?: "summary" | "category";
  /** The region this row narrows, for a screen reader. */
  controls?: string;
}) {
  return (
    <button
      type="button"
      // "Active 18", not "Active18": the count is said as a word of its own.
      aria-label={count !== undefined ? `${label} ${count}` : undefined}
      aria-pressed={selected}
      aria-controls={controls}
      onClick={onSelect}
      className={cn(
        "flex w-[150px] cursor-pointer items-center rounded-[4px] text-left text-[13px] leading-[19px] tracking-[0.4px] text-foreground outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-wz-focus",
        variant === "category" ? "h-9 gap-2 px-[6.5px] py-2" : "h-8 justify-between px-2 py-[6.5px]",
        selected && "bg-wz-secondary-hover",
      )}
    >
      {icon ? <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 truncate">{label}</span>
      {count !== undefined ? <span className="text-wz-outline-label tabular-nums">{count}</span> : null}
    </button>
  );
}

/** "AUTOMATIONS TRIGGERED" over its figure (10px/14px 500 #566d76 capitals; 28px/42px 300). */
export function CenterStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="mt-[27px]">
      <p className="text-[10px] leading-[14px] font-medium tracking-[0.4px] text-wz-slate uppercase">{label}</p>
      <p className="mt-1 text-[28px] leading-[42px] font-light tracking-[0.2px] text-foreground tabular-nums">{value}</p>
    </div>
  );
}

/** The blue action at the foot of the left column (Workiz's "+ Add signature": 13px/19px 600 #6aa8ee). */
export function CenterFootLink({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="-mr-10 flex cursor-pointer items-center gap-1.5 text-left text-[13px] leading-[19px] font-semibold tracking-[0.4px] whitespace-nowrap text-wz-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      {children}
    </button>
  );
}

/** The Center's card shadow (`ruleCard` container): `0 4px 12px rgba(59,75,82,.1), 0 0 4px rgba(59,75,82,.05)`. */
export const CENTER_CARD_SHADOW = "shadow-[0_4px_12px_rgba(59,75,82,0.1),0_0_4px_rgba(59,75,82,0.05)]";

/**
 * The title row of a Center card: the name 14px/22px 600 ink (cut with "…"),
 * then the green 28×4 #50d58c bar 6px under it and 16px over what follows.
 */
export function CenterCardBar() {
  return <span aria-hidden="true" className="mt-1.5 mb-4 block h-1 w-7 rounded-[4px] bg-wz-switch-on" />;
}

/**
 * The info row at a Center card's foot (`ruleCard` infoWrapper): under a 1px
 * #dbdddf rule, 12px down, facts in 11px/16px ink with the numbers 13px 600,
 * each after the first behind a 16px #dbdddf rule.
 */
export function CenterFacts({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative flex flex-wrap items-center gap-y-[7px] border-t border-[#dbdddf] pt-3", className)}>
      {children}
    </div>
  );
}

export function CenterFact({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <span className="flex items-center">
      {first ? null : <span aria-hidden="true" className="mr-[18px] ml-4 h-4 w-px bg-[#dbdddf]" />}
      <span className="text-[11px] leading-4 tracking-[0.4px] text-foreground">{children}</span>
    </span>
  );
}

/** A number inside a fact: "Triggered **44** times". */
export const CenterFactNumber = ({ children }: { children: ReactNode }) => (
  <span className="text-[13px] leading-4 font-semibold">{children}</span>
);

/**
 * Workiz's `emptyState` (pg_automations_wz_07_search_empty / _14): the picture
 * 60px under the actions, 24px over an 18px/27px 600 heading, the words
 * 14px/21px at most 429px wide 8px under it, the action 24px under them.
 */
export function CenterEmptyState({
  art,
  title,
  children,
  action,
}: {
  art: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role="status" className="mt-[60px] flex w-full flex-col items-center text-center">
      <div className="mb-6">{art}</div>
      <h4 className="text-lg leading-[27px] font-semibold tracking-[0.4px] text-foreground">{title}</h4>
      {children ? (
        <div className="mt-2 max-w-[429px] text-sm leading-[21px] tracking-[0.4px] text-foreground">{children}</div>
      ) : null}
      {action ? <div className="mt-6 flex flex-wrap items-center justify-center gap-4">{action}</div> : null}
    </div>
  );
}

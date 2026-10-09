"use client";

import { useState, type MouseEvent } from "react";
import { Copy, Eye, History, Info, Pencil, RotateCw, Trash2 } from "lucide-react";
import type { AutomationLabelMap, AutomationRule } from "@bitcrm/types";
import { WzDotsMenu, type WzDotsMenuItem } from "@/components/workiz/dots-menu";
import { WzSwitch } from "@/components/workiz/toggles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  canEnable,
  conditionCount,
  firingCount,
  formatEditedAt,
  formatFiredAt,
  ruleDateLine,
  ruleSentence,
} from "../lib";
import { AutomationPreviewDialog, previewableMessages } from "./automation-preview-dialog";
import { AutomationSentence } from "./automation-sentence";
import {
  CENTER_CARD_SHADOW,
  CenterCardBar,
  CenterFact as Fact,
  CenterFactNumber as Bold,
  CenterFacts,
} from "./automation-center";

/** A label in Workiz's `readOnly` dress: 10px 600 capitals, #7a8b98. */
const LABEL = "text-[10px] leading-4 font-semibold tracking-[0.5px] text-wz-stat-slate uppercase";

/**
 * One rule in "My Automations" (Workiz's `ruleCard` in the Center,
 * pg_automations_wz_10_mine / _11_mine_card_hover / _12_dots_open):
 *
 *   card      white, 16px corners, 24px in (20px at the foot), the shadow
 *             `0 4px 12px rgba(59,75,82,.1), 0 0 4px rgba(59,75,82,.05)`; under
 *             the cursor the left corners go to 8px and an 8px #50d58c bar
 *             shows on the left (GreenBarWrapper);
 *   header    the name 14px/22px 600 ink, cut with "…"; the 40×20 switch at the right;
 *   bar       28×4 #50d58c, 6px under the name, 16px over the sentence;
 *   sentence  14px/22px #9ea6aa with the picked parts 500 ink underlined;
 *   info      under a 1px #dbdddf rule, 12px down: "Modified on …" | "Triggered
 *             N times" | "This rule contains N conditions" (11px/16px, the
 *             numbers 13px 600), and the ••• menu at the far right.
 *
 * Ours beside Workiz's: "Built in" / "Cannot run here" by the name, the
 * translator's note under the sentence, "N in Workiz" and "Last fired …" in
 * the info row, and View history in the menu. Clicking the card opens the
 * rule, as in Workiz.
 */
export function AutomationRuleCard({
  rule,
  labels,
  canEdit,
  busy,
  onToggle,
  onEdit,
  onDuplicate,
  onRename,
  onHistory,
  onDelete,
}: {
  rule: AutomationRule;
  labels?: AutomationLabelMap;
  canEdit: boolean;
  /** A mutation is in flight somewhere in the list — freeze the switch. */
  busy?: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const enable = canEnable(rule);
  const fired = firingCount(rule) ?? 0;
  const conditions = conditionCount(rule);
  // A rule with a sentence is drawn with its slots; a built-in rule has only
  // its description, which is prose, not a sentence with parts to pick.
  const sentence = ruleSentence(rule, labels);
  const dated = ruleDateLine(rule);
  const canPreview = previewableMessages(rule).length > 0;

  const [previewing, setPreviewing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(rule.name);

  const startRename = () => {
    setDraft(rule.name);
    setRenaming(true);
  };
  const finishRename = (keep: boolean) => {
    const name = draft.trim();
    setRenaming(false);
    if (keep && name && name !== rule.name) onRename(name);
  };

  // Workiz opens the rule from anywhere on its card; the switch, the menu and
  // the links inside keep their own clicks.
  const open = (e: MouseEvent<HTMLDivElement>) => {
    if (!canEdit || renaming) return;
    const target = e.target as HTMLElement;
    // A click in a portal (the menu, the preview) reaches here through React,
    // not through the page: only a click on the card itself opens the rule.
    if (!e.currentTarget.contains(target)) return;
    if (target.closest("button, a, input, label, [role=menu]")) return;
    onEdit();
  };

  const items: WzDotsMenuItem[] = [
    ...(canPreview
      ? [{ key: "preview", label: "Preview", icon: <Eye strokeWidth={1.5} />, onSelect: () => setPreviewing(true) }]
      : []),
    ...(canEdit
      ? [
          { key: "edit", label: "Edit", icon: <Pencil strokeWidth={1.5} />, onSelect: onEdit },
          { key: "duplicate", label: "Duplicate", icon: <Copy strokeWidth={1.5} />, onSelect: onDuplicate },
          { key: "rename", label: "Rename", icon: <RotateCw strokeWidth={1.5} />, onSelect: startRename },
        ]
      : []),
    { key: "history", label: "View history", icon: <History strokeWidth={1.5} />, onSelect: onHistory },
    ...(canEdit
      ? [
          rule.builtin
            ? {
                // A built-in rule is part of the service; switching it off is
                // how it stops. Said in the menu itself, not left to a dead item.
                key: "delete",
                label: "Delete",
                icon: <Trash2 strokeWidth={1.5} />,
                onSelect: () => undefined,
                disabled: true,
                destructive: true,
                "aria-label": `Delete ${rule.name}`,
                note: "A built-in rule is turned off, not deleted.",
              }
            : {
                key: "delete",
                label: "Delete",
                icon: <Trash2 strokeWidth={1.5} />,
                onSelect: onDelete,
                destructive: true,
                "aria-label": `Delete ${rule.name}`,
              },
        ]
      : []),
  ];

  return (
    <div data-testid={`automation-${rule.id}`} className="group/rule relative">
      {/* GreenBarWrapper: the 8px bar that marks the card under the cursor. */}
      <span
        aria-hidden="true"
        className="invisible absolute inset-y-0 left-0 z-[1] w-2 rounded-l-[16px] bg-wz-switch-on opacity-0 transition-[visibility,opacity] duration-200 group-hover/rule:visible group-hover/rule:opacity-100"
      />
      <div
        onClick={open}
        className={cn(
          "flex flex-col rounded-[16px] bg-white px-6 pt-6 pb-5 group-hover/rule:rounded-l-[8px]",
          CENTER_CARD_SHADOW,
          canEdit && "cursor-pointer",
        )}
      >
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {renaming ? (
              <input
                aria-label="Rule name"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finishRename(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    finishRename(true);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    finishRename(false);
                  }
                }}
                // Workiz's title while it is being renamed: a 2px ink rule under it.
                className="w-[30vw] max-w-full min-w-0 border-0 border-b-2 border-foreground bg-transparent pb-[5px] text-sm leading-[22px] font-semibold tracking-[0.4px] text-foreground outline-none"
              />
            ) : (
              <h4 className="max-w-[30vw] truncate text-sm leading-[22px] font-semibold tracking-[0.4px] text-foreground">
                {rule.name}
              </h4>
            )}
            {rule.builtin ? <span className={LABEL}>Built in</span> : null}
            {!enable ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className={cn(LABEL, "inline-flex shrink-0 items-center gap-1 outline-none")}>
                    <Info className="size-3" aria-hidden="true" />
                    Cannot run here
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  {rule.notRunnableReason ?? "This rule has nothing the engine can run."}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <WzSwitch
            checked={rule.enabled}
            disabled={!canEdit || (!enable && !rule.enabled) || busy}
            aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
            onCheckedChange={onToggle}
          />
        </div>

        <CenterCardBar />

        {sentence ? (
          <AutomationSentence text={sentence} className="mb-3 text-sm leading-[22px] tracking-[0.4px]" />
        ) : (
          <p className="mb-3 text-sm leading-[22px] tracking-[0.4px] text-wz-outline">{rule.description || "—"}</p>
        )}
        {rule.specNotes?.length ? (
          <p className="-mt-2 mb-3 text-xs leading-4 tracking-[0.4px] text-wz-outline">{rule.specNotes[0]}</p>
        ) : null}

        <CenterFacts className="pr-12">
          <Fact first>
            {dated.verb} {formatEditedAt(dated.at)}
          </Fact>
          <Fact>
            <button
              type="button"
              onClick={onHistory}
              aria-label={`Firing log of ${rule.name}`}
              className="cursor-pointer outline-none hover:underline focus-visible:ring-2 focus-visible:ring-wz-focus"
            >
              Triggered <Bold>{fired}</Bold> {fired === 1 ? "time" : "times"}
            </button>
          </Fact>
          <Fact>
            This rule contains <Bold>{conditions}</Bold> {conditions === 1 ? "condition" : "conditions"}
          </Fact>
          {/* Workiz prints its counts bare — "Triggered 1552 times", never "1,552". */}
          {rule.workizTriggered ? <Fact>{rule.workizTriggered} in Workiz</Fact> : null}
          {rule.lastFiredAt ? <Fact>Last fired {formatFiredAt(rule.lastFiredAt)}</Fact> : null}
          <WzDotsMenu
            aria-label={`Actions for ${rule.name}`}
            items={items}
            className="absolute top-1/2 right-0 mt-1.5 -translate-y-1/2"
          />
        </CenterFacts>
      </div>
      {previewing ? <AutomationPreviewDialog rule={rule} open onOpenChange={setPreviewing} /> : null}
    </div>
  );
}

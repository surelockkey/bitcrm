"use client";

import { Fragment, useMemo } from "react";
import { X } from "lucide-react";
import {
  AUTOMATION_TEMPLATES,
  AUTOMATION_TEMPLATE_SECTIONS,
  type AutomationTemplate,
  type AutomationTemplateSection,
} from "../templates";
import { NoResultsArt } from "./automation-center-art";
import { CenterEmptyState } from "./automation-center";

/** `<the assigned techs>` → the words alone; what a reader searches on. */
const plainSentence = (sentence: string) => sentence.replace(/[<>]/g, "");

const matches = (template: AutomationTemplate, search: string) => {
  const haystack = `${template.title} ${plainSentence(template.sentence)} ${template.blurb}`.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
};

/** The anchor a section's left-column row scrolls to. */
export const librarySectionId = (section: AutomationTemplateSection) =>
  `automation-library-${section.replace(/\s+/g, "-")}`;

/** The sections a search leaves something in, in the library's order. */
export function librarySections(search: string) {
  const query = search.trim();
  return AUTOMATION_TEMPLATE_SECTIONS.map((section) => ({
    section,
    templates: AUTOMATION_TEMPLATES.filter((t) => t.section === section && (!query || matches(t, query))),
  })).filter((group) => group.templates.length > 0);
}

/**
 * The sentence as Workiz's template card draws it (`RuleCardTemplate`):
 * 16px/22px ink, the parts a person edits 600 and underlined. Split on the
 * markers rather than replacing them, so a slot is one element a test can find.
 */
function TemplateSentence({ sentence }: { sentence: string }) {
  const parts = sentence.split(/(<[^<>]+>)/g).filter(Boolean);
  return (
    <p className="mt-[14px] line-clamp-3 max-w-[95%] text-base leading-[22px] tracking-[0.4px] text-foreground">
      {parts.map((part, i) =>
        part.startsWith("<") && part.endsWith(">") ? (
          <span key={i} data-template-slot className="font-semibold underline">
            {part.slice(1, -1)}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

/**
 * One template (Workiz's `ruleCard smallContainer`, pg_automations_wz_03 /
 * _04_card_hover): 304×176, white, 16px corners, 24px 24px 20px 20px, the
 * Center's two-part shadow; the title as a chip (11px/24px 500 capitalised on
 * #e0eaef, 4px corners, 8px in, 12px down); the sentence 14px under it; under
 * the cursor the left corners go to 8px, the 8px #50d58c bar shows and the
 * "use" pill (12px 600 #6aa8ee, 1px edge, round, 1px 9px; filled when
 * hovered) appears bottom right. Workiz takes the template on a click
 * anywhere on the card; so do we. The pill stays reachable by keyboard.
 */
function TemplateCard({
  template,
  canEdit,
  onUse,
}: {
  template: AutomationTemplate;
  canEdit: boolean;
  onUse: (template: AutomationTemplate) => void;
}) {
  const blurbId = `automation-template-${template.id}-blurb`;
  return (
    <div data-testid={`automation-template-${template.id}`} className="group/recipe relative h-[176px] w-[304px]">
      <span
        aria-hidden="true"
        className="invisible absolute inset-y-0 left-0 z-[1] w-2 rounded-l-[16px] bg-wz-switch-on opacity-0 transition-[visibility,opacity] duration-200 group-hover/recipe:visible group-hover/recipe:opacity-100 group-focus-within/recipe:visible group-focus-within/recipe:opacity-100"
      />
      <div
        title={template.blurb}
        onClick={(e) => {
          if (!canEdit || (e.target as HTMLElement).closest("button")) return;
          onUse(template);
        }}
        className="flex h-full flex-col rounded-[16px] bg-white pt-6 pr-6 pb-5 pl-5 shadow-[0_4px_12px_rgba(59,75,82,0.1),0_0_4px_rgba(59,75,82,0.05)] group-hover/recipe:rounded-l-[8px] group-focus-within/recipe:rounded-l-[8px] data-[edit=true]:cursor-pointer"
        data-edit={canEdit}
      >
        <div className="flex items-center gap-2">
          <h4 className="mt-3 w-fit truncate rounded-[4px] bg-[#e0eaef] px-2 text-[11px] leading-6 font-medium tracking-[0.4px] text-foreground capitalize">
            {template.title}
          </h4>
          {template.popular ? (
            // Ours: Workiz's `additionalLabel` (white on #6aa8ee, 10px, 4px corners).
            <span className="mt-3 shrink-0 rounded-[4px] bg-wz-link px-1.5 py-[3px] text-[10px] leading-none text-white">
              Most used here
            </span>
          ) : null}
        </div>
        <TemplateSentence sentence={template.sentence} />
        <p id={blurbId} className="sr-only">
          {template.blurb}
        </p>
        {canEdit ? (
          <div className="mt-auto flex shrink-0 items-center justify-end">
            <button
              type="button"
              aria-label={`Use ${template.title}`}
              aria-describedby={blurbId}
              onClick={() => onUse(template)}
              className="cursor-pointer rounded-pill border border-wz-link px-[9px] py-px text-xs leading-4 font-semibold tracking-[0.4px] text-wz-link outline-none hover:bg-wz-link hover:text-white focus-visible:ring-2 focus-visible:ring-wz-focus sm:opacity-0 sm:group-hover/recipe:opacity-100 sm:group-focus-within/recipe:opacity-100"
            >
              use
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Workiz's Discover banner (`TemplateRules` lottie, 1024×129, #3b4b52, 16px
 * corners): its animated sentence at rest — "When this happens, do this
 * action" — with the × that puts it away.
 */
export function DiscoverBanner({ onHide }: { onHide: () => void }) {
  return (
    <div className="relative mb-[25px] flex h-[129px] max-w-[1024px] items-center justify-center rounded-[16px] bg-[#3b4b52]">
      <p className="text-[34px] leading-[48px] font-semibold tracking-[-1px] text-white">
        When <span className="text-wz-switch-on">this</span> happens,&nbsp; do <span className="text-wz-switch-on">this</span> action
      </p>
      <button
        type="button"
        aria-label="Hide the banner"
        onClick={onHide}
        className="absolute top-4 right-4 grid size-6 cursor-pointer place-items-center text-white outline-none focus-visible:ring-2 focus-visible:ring-wz-focus"
      >
        <X className="size-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}

/**
 * The Discover tab (Workiz "Automation Center" → Discover): ready recipes
 * grouped by section — 16px/24px 600 headings 55px apart, three 304px cards a
 * row 26px apart in a 1000px band. What happens after Use — the builder, the
 * save — belongs to the page, not here.
 */
export function AutomationLibrary({
  canEdit,
  search = "",
  onUse,
}: {
  canEdit: boolean;
  search?: string;
  onUse: (template: AutomationTemplate) => void;
}) {
  const sections = useMemo(() => librarySections(search), [search]);

  return (
    <div data-testid="automation-library">
      {canEdit ? null : (
        <p className="mb-4 text-[13px] leading-[19px] tracking-[0.4px] text-wz-outline-label">
          You can read the recipes, but adding an automation needs permission to edit them.
        </p>
      )}

      {sections.length === 0 ? (
        <CenterEmptyState art={<NoResultsArt />} title="No results found">
          Try using different phrase or keywords.
        </CenterEmptyState>
      ) : null}

      <div className="flex flex-col gap-[55px] pb-[15vh]">
        {sections.map(({ section, templates }) => (
          <section key={section} id={librarySectionId(section)} aria-labelledby={`${librarySectionId(section)}-title`} className="scroll-mt-0">
            <h3
              id={`${librarySectionId(section)}-title`}
              className="mb-4 text-base leading-6 font-semibold tracking-[0.2px] text-foreground"
            >
              {section}
            </h3>
            <div className="grid max-w-[1000px] grid-cols-[repeat(auto-fill,304px)] justify-between gap-y-[26px] min-[1100px]:grid-cols-[repeat(3,304px)]">
              {templates.map((template) => (
                <TemplateCard key={template.id} template={template} canEdit={canEdit} onUse={onUse} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

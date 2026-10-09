"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import type { AutomationLabelMap, AutomationRule } from "@bitcrm/types";
import { WzButton } from "@/components/workiz/button";
import { WzSearchBox } from "@/components/workiz/toolbar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import {
  useAutomations,
  useAutomationsAccess,
  useDuplicateAutomation,
  useMigrateAutomations,
  useUpdateAutomation,
} from "../hooks";
import {
  SORT_LABEL,
  STATE_LABEL,
  TRIGGER_LABEL,
  type AutomationFilter,
  type AutomationSort,
  type AutomationState,
  categoryCounts,
  categoryLabel,
  filterRules,
  isFiltered,
  stateCounts,
  totalFirings,
} from "../lib";
import { AUTOMATION_TEMPLATE_SECTIONS, type AutomationTemplate, type AutomationTemplateSection } from "../templates";
import {
  CenterEmptyState,
  CenterFootLink,
  CenterFrame,
  CenterNavRow,
  CenterSideTitle,
  CenterStat,
  CenterTabs,
} from "./automation-center";
import { EmptyAutomationsArt } from "./automation-center-art";
import { SECTION_ICON } from "./automation-center-icons";
import { AutomationDeleteDialog } from "./automation-delete-dialog";
import { AutomationFormDialog, type AutomationDraft } from "./automation-form-dialog";
import { AutomationLibrary, DiscoverBanner, librarySectionId } from "./automation-library";
import { AutomationRuleCard } from "./automation-rule-card";
import { AutomationRunsDialog } from "./automation-runs-dialog";

const ALL = "all";

/** The state rows of the left column, in Workiz's order, ours ("Cannot run") last. */
const STATE_ROWS: Array<{ state?: AutomationState; label: string }> = [
  { label: "All" },
  { state: "on", label: "Active" },
  { state: "off", label: "Inactive" },
  { state: "blocked", label: STATE_LABEL.blocked },
];

/** Workiz's Discover banner, once put away, stays away for this reader. */
const BANNER_KEY = "automations.discover.banner.hidden";
const readBannerHidden = () => {
  try {
    return window.localStorage.getItem(BANNER_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * The Automation Center (Workiz's own module, Features → Automations,
 * pg_automations_wz_*): Discover — the recipes to start from — and My
 * Automations — the rules this workspace owns, every one the service runs, the
 * ones translated from the Workiz export and the ones that could not be. The
 * frame is Workiz's (`automation-center.tsx`); Activity is the third tab.
 */
export function AutomationsPage() {
  const params = useSearchParams();
  const asked = params?.get("view");
  const { canView, canEdit, isLoading: accessLoading } = useAutomationsAccess();
  const rulesQuery = useAutomations(canView);
  const rules = rulesQuery.data;
  const update = useUpdateAutomation();
  const duplicate = useDuplicateAutomation();
  const migrate = useMigrateAutomations();

  const [search, setSearch] = useState("");
  const [state, setState] = useState<AutomationState | undefined>();
  const [trigger, setTrigger] = useState<string>(ALL);
  const [category, setCategory] = useState<string | undefined>();
  const [sort, setSort] = useState<AutomationSort>("used");
  // Left unset until the reader picks a tab (or a link names one), so the
  // default can follow the data: a workspace with rules opens on them, an
  // empty one on Discover.
  const [tab, setTab] = useState<"discover" | "mine" | undefined>(
    asked === "discover" || asked === "mine" ? asked : undefined,
  );
  const [section, setSection] = useState<AutomationTemplateSection>(AUTOMATION_TEMPLATE_SECTIONS[0]);
  // Read once the page is up rather than while it renders on the server: the
  // stored choice lives only in this browser.
  const [bannerChoice, setBannerChoice] = useState<boolean | undefined>();

  const [editing, setEditing] = useState<AutomationRule | undefined>();
  const [draft, setDraft] = useState<AutomationDraft | undefined>();
  const [creating, setCreating] = useState(false);
  const [showing, setShowing] = useState<AutomationRule | undefined>();
  const [deleting, setDeleting] = useState<AutomationRule | undefined>();

  // Ids in a rule read as uuids; the catalogs turn them back into names.
  const tagsQuery = useJobTags();
  const typesQuery = useJobTypes();
  const sourcesQuery = useJobSources();
  const statusesQuery = useJobStatuses();
  const { data: tags } = tagsQuery;
  const { data: types } = typesQuery;
  const { data: sources } = sourcesQuery;
  const { data: statuses } = statusesQuery;
  const labels = useMemo<AutomationLabelMap>(() => {
    const map: AutomationLabelMap = {};
    for (const row of [...(tags ?? []), ...(types ?? []), ...(sources ?? []), ...(statuses ?? [])]) {
      map[row.id] = row.name;
    }
    return map;
  }, [tags, types, sources, statuses]);

  const all = useMemo(() => rules ?? [], [rules]);
  const filter: AutomationFilter = useMemo(
    () => ({
      search,
      states: state ? [state] : [],
      trigger: trigger === ALL ? undefined : (trigger as AutomationFilter["trigger"]),
      category,
      sort,
    }),
    [search, state, trigger, category, sort],
  );
  const visible = useMemo(() => filterRules(all, filter, labels), [all, filter, labels]);
  const counts = useMemo(() => stateCounts(all), [all]);
  const categories = useMemo(() => categoryCounts(all), [all]);

  const narrowed = isFiltered(filter);
  // An empty workspace is a fact about the answer, not about the wait: while
  // the list is loading stay on the rules, so the skeleton is what a reader
  // sees instead of Discover flashing up and being replaced.
  //
  // And the numbers wait with the rules, and the rules with the catalogs: a
  // count over the skeleton changed under the reader when the rules came, and
  // a sentence written with raw ids re-wrapped its card — and moved every card
  // below — when the names arrived. One skeleton, then all of it in one frame;
  // the page never goes back to the skeleton after.
  const ready = usePageReady(
    !accessLoading && [rulesQuery, tagsQuery, typesQuery, sourcesQuery, statusesQuery].every(settled),
  );
  const activeTab = tab ?? (!ready || all.length ? "mine" : "discover");

  // Discover's left rows follow the list as it scrolls, as Workiz's do: the
  // section whose heading has reached the top band of the window is the one
  // marked. (Workiz's AnchorLink; here an observer, no scroll handler.)
  const showingDiscover = ready && activeTab === "discover";
  useEffect(() => {
    if (!showingDiscover || typeof IntersectionObserver === "undefined") return;
    const sections = AUTOMATION_TEMPLATE_SECTIONS.map((name) => document.getElementById(librarySectionId(name))).filter(
      (el): el is HTMLElement => !!el,
    );
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const name = AUTOMATION_TEMPLATE_SECTIONS.find((s) => librarySectionId(s) === top?.target.id);
        if (name) setSection(name);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [showingDiscover, search]);

  const clearFilters = () => {
    setSearch("");
    setState(undefined);
    setTrigger(ALL);
    setCategory(undefined);
  };

  const openCreate = (from?: AutomationDraft) => {
    setDraft(from);
    setCreating(true);
  };

  const bannerHidden = bannerChoice ?? (ready ? readBannerHidden() : true);
  const hideBanner = () => {
    setBannerChoice(true);
    try {
      window.localStorage.setItem(BANNER_KEY, "1");
    } catch {
      // A private window: the banner comes back next time, which is all.
    }
  };

  // Refused only once the permissions say so — not while they are coming.
  if (!accessLoading && !canView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-semibold">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view automations.</p>
      </div>
    );
  }

  const listId = "automation-rules";

  const side =
    activeTab === "discover" ? (
      <nav aria-label="Categories">
        <div className="mb-4">
          <CenterSideTitle>Categories</CenterSideTitle>
        </div>
        <div className="flex flex-col gap-1">
          {AUTOMATION_TEMPLATE_SECTIONS.map((name) => {
            const Icon = SECTION_ICON[name];
            return (
              <CenterNavRow
                key={name}
                variant="category"
                label={name}
                icon={<Icon />}
                selected={section === name}
                onSelect={() => {
                  setSection(name);
                  document.getElementById(librarySectionId(name))?.scrollIntoView({ block: "start", behavior: "smooth" });
                }}
              />
            );
          })}
        </div>
      </nav>
    ) : (
      <div>
        <CenterSideTitle id="automation-states-title">My Automations</CenterSideTitle>
        <div role="group" aria-labelledby="automation-states-title" className="flex flex-col gap-1 border-b border-border py-6">
          {STATE_ROWS.map((row) => (
            <CenterNavRow
              key={row.label}
              label={row.label}
              count={row.state ? counts[row.state] : counts.all}
              selected={state === row.state}
              controls={listId}
              onSelect={() => setState(row.state)}
            />
          ))}
        </div>
        {categories.length > 1 ? (
          <div role="group" aria-labelledby="automation-categories-title" className="flex flex-col gap-1 border-b border-border py-6">
            <div className="mb-3">
              <CenterSideTitle id="automation-categories-title">Categories</CenterSideTitle>
            </div>
            {categories.map((row) => (
              <CenterNavRow
                key={row.category}
                label={categoryLabel(row.category)}
                count={row.count}
                selected={category === row.category}
                controls={listId}
                // A second press on the chosen category lets it go, back to every one.
                onSelect={() => setCategory((current) => (current === row.category ? undefined : row.category))}
              />
            ))}
          </div>
        ) : null}
        <CenterStat label="Automations triggered" value={totalFirings(all)} />
      </div>
    );

  const foot = canEdit ? (
    // Writes the translation of every imported Workiz rule to its row, so the
    // specs can be edited and stop being recomputed on read. Idempotent, and it
    // never touches a rule somebody edited by hand. Workiz's "+ Add signature"
    // sits here; we have no signature, and this is our one housekeeping action.
    <CenterFootLink
      icon={migrate.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      onClick={() => migrate.mutate(undefined)}
      disabled={migrate.isPending}
    >
      Re-check imports
    </CenterFootLink>
  ) : null;

  const actions = (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <WzSearchBox
          value={search}
          onChange={setSearch}
          aria-label="Search automations"
          placeholder={activeTab === "discover" ? "Search the template" : "Search"}
          className="w-[376px]"
        />
        {activeTab === "mine" ? (
          <>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger className="h-10 w-[200px]" aria-label="Trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All triggers</SelectItem>
                {Object.entries(TRIGGER_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as AutomationSort)}>
              <SelectTrigger className="h-10 w-[170px]" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SORT_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {narrowed ? (
              <button
                type="button"
                onClick={clearFilters}
                className="cursor-pointer text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-wz-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-wz-focus"
              >
                Clear filters
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {canEdit ? (
        <WzButton size="regular" icon={<Plus className="size-[19px]" strokeWidth={1.5} />} onClick={() => openCreate()}>
          Add automation
        </WzButton>
      ) : null}
    </>
  );

  return (
    <>
      <CenterFrame
        waiting={!ready}
        side={side}
        foot={foot}
        tabs={<CenterTabs active={activeTab} onSelect={setTab} />}
        actions={actions}
      >
        {!ready ? (
          <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading the automations">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[159px] w-full rounded-[16px]" />
            ))}
          </div>
        ) : activeTab === "discover" ? (
          <>
            {bannerHidden || search.trim() ? null : <DiscoverBanner onHide={hideBanner} />}
            <AutomationLibrary
              canEdit={canEdit}
              search={search}
              // The recipe's own id travels with its draft: it is what keys the
              // editor below, and a draft has no id of its own to key it by.
              onUse={(template: AutomationTemplate) => openCreate({ ...template.draft, id: template.id })}
            />
          </>
        ) : all.length === 0 ? (
          <CenterEmptyState
            art={<EmptyAutomationsArt />}
            title="No automations yet"
            action={
              <>
                <WzButton size="regular" variant="secondary" onClick={() => setTab("discover")}>
                  Start with a template
                </WzButton>
                {canEdit ? (
                  <WzButton size="regular" variant="secondary" icon={<Plus className="size-[19px]" strokeWidth={1.5} />} onClick={() => openCreate()}>
                    Create new
                  </WzButton>
                ) : null}
              </>
            }
          >
            Start from a recipe in Discover, or create one of your own.
          </CenterEmptyState>
        ) : visible.length === 0 ? (
          <CenterEmptyState
            art={<EmptyAutomationsArt />}
            title="No automations found"
            action={
              <>
                <WzButton size="regular" variant="secondary" onClick={clearFilters}>
                  Clear filters
                </WzButton>
                {canEdit ? (
                  <WzButton size="regular" variant="secondary" icon={<Plus className="size-[19px]" strokeWidth={1.5} />} onClick={() => openCreate()}>
                    Create new
                  </WzButton>
                ) : null}
              </>
            }
          >
            We couldn&apos;t find any automations based on your search. Try a different term or create a new one to
            get started.
          </CenterEmptyState>
        ) : (
          <div id={listId} className="flex flex-col gap-6 pt-1 pb-[25px]">
            {visible.map((rule) => (
              <AutomationRuleCard
                key={rule.id}
                rule={rule}
                labels={labels}
                canEdit={canEdit}
                busy={update.isPending}
                onToggle={(enabled) => update.mutate({ id: rule.id, body: { enabled } })}
                onEdit={() => setEditing(rule)}
                // "… (copy)" is named here, not left to the endpoint: two
                // rules under one name is how a list of 80 becomes unreadable.
                onDuplicate={() => duplicate.mutate({ id: rule.id, name: `${rule.name} (copy)` })}
                onRename={(name) => update.mutate({ id: rule.id, body: { name } })}
                onHistory={() => setShowing(rule)}
                onDelete={() => setDeleting(rule)}
              />
            ))}
          </div>
        )}
      </CenterFrame>

      {editing ? (
        // Keyed by the rule: the editor reads the rule into form state once,
        // when it mounts, so a swap straight from one rule to another would
        // otherwise show the first one's values under the second one's name.
        <AutomationFormDialog
          key={editing.id}
          rule={editing}
          open
          labels={labels}
          onOpenChange={(open) => !open && setEditing(undefined)}
        />
      ) : null}
      {creating ? (
        // Keyed like the editor above, by the recipe the draft came from: a
        // second recipe taken without closing the first would otherwise leave
        // the first draft's trigger and message under the second one's name.
        // A blank rule is keyed by the absence of one — there is nothing to
        // re-read, and every blank draft starts from the same empty form.
        <AutomationFormDialog
          key={draft?.id ?? "blank"}
          draft={draft}
          open
          labels={labels}
          onOpenChange={(open) => !open && setCreating(false)}
        />
      ) : null}
      {showing ? (
        <AutomationRunsDialog rule={showing} open onOpenChange={(open) => !open && setShowing(undefined)} />
      ) : null}
      {deleting ? (
        <AutomationDeleteDialog
          rule={deleting}
          open
          onOpenChange={(open) => !open && setDeleting(undefined)}
        />
      ) : null}
    </>
  );
}

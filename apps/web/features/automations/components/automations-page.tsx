"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, Workflow } from "lucide-react";
import type { AutomationLabelMap, AutomationRule } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  categoryLabel,
  filterRules,
  isFiltered,
  ruleCategories,
} from "../lib";
import type { AutomationTemplate } from "../templates";
import { AutomationDeleteDialog } from "./automation-delete-dialog";
import { AutomationFormDialog, type AutomationDraft } from "./automation-form-dialog";
import { AutomationLibrary } from "./automation-library";
import { AutomationRuleCard } from "./automation-rule-card";
import { AutomationRunsDialog } from "./automation-runs-dialog";

const STATES: AutomationState[] = ["on", "off", "blocked"];
const ALL = "all";

/**
 * The Automation Center (Workiz's own module, §4.2): a library of recipes to
 * start from and the rules this workspace owns. Every rule the service runs,
 * the ones translated from the Workiz export and the ones that could not be —
 * with the Workiz sentence under each name, how often it has fired, and a switch.
 */
export function AutomationsPage() {
  const { canView, canEdit } = useAutomationsAccess();
  const { data: rules, isLoading } = useAutomations(canView);
  const update = useUpdateAutomation();
  const duplicate = useDuplicateAutomation();
  const migrate = useMigrateAutomations();

  const [search, setSearch] = useState("");
  const [states, setStates] = useState<AutomationState[]>([]);
  const [trigger, setTrigger] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [sort, setSort] = useState<AutomationSort>("used");
  // Left unset until the reader picks a tab, so the default can follow the
  // data: a workspace with rules opens on them, an empty one on the library.
  const [tab, setTab] = useState<string | undefined>();

  const [editing, setEditing] = useState<AutomationRule | undefined>();
  const [draft, setDraft] = useState<AutomationDraft | undefined>();
  const [creating, setCreating] = useState(false);
  const [showing, setShowing] = useState<AutomationRule | undefined>();
  const [deleting, setDeleting] = useState<AutomationRule | undefined>();

  // Ids in a rule read as uuids; the catalogs turn them back into names.
  const { data: tags } = useJobTags();
  const { data: types } = useJobTypes();
  const { data: sources } = useJobSources();
  const { data: statuses } = useJobStatuses();
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
      states,
      trigger: trigger === ALL ? undefined : (trigger as AutomationFilter["trigger"]),
      category: category === ALL ? undefined : category,
      sort,
    }),
    [search, states, trigger, category, sort],
  );
  const visible = useMemo(() => filterRules(all, filter, labels), [all, filter, labels]);
  const categories = useMemo(() => ruleCategories(all), [all]);

  const running = all.filter((r) => r.enabled).length;
  const narrowed = isFiltered(filter);
  const activeTab = tab ?? (all.length ? "mine" : "library");

  const clearFilters = () => {
    setSearch("");
    setStates([]);
    setTrigger(ALL);
    setCategory(ALL);
  };

  const openCreate = (from?: AutomationDraft) => {
    setDraft(from);
    setCreating(true);
  };

  if (!canView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view automations.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Automations</h1>
          <p className="text-sm text-muted-foreground">
            What the system sends on its own. {running} of {all.length} rules are on.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search automations…"
              aria-label="Search automations"
              className="h-9 w-56 pl-8"
            />
          </div>
          {canEdit ? (
            // Writes the translation of every imported Workiz rule to its row,
            // so the specs can be edited and stop being recomputed on read.
            // Idempotent, and it never touches a rule somebody edited by hand.
            <Button
              variant="outline"
              size="lg"
              disabled={migrate.isPending}
              onClick={() => migrate.mutate(undefined)}
            >
              {migrate.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Re-check imported rules
            </Button>
          ) : null}
          {canEdit ? (
            <Button variant="brand" size="lg" onClick={() => openCreate()}>
              <Plus className="size-4" />
              Create automation
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="mine">My automations · {all.length}</TabsTrigger>
        </TabsList>

        <TabsContent value="library">
          <AutomationLibrary
            canEdit={canEdit}
            search={search}
            onUse={(template: AutomationTemplate) => openCreate(template.draft)}
          />
        </TabsContent>

        <TabsContent value="mine" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {STATES.map((state) => (
              <Button
                key={state}
                size="sm"
                variant={states.includes(state) ? "secondary" : "outline"}
                aria-pressed={states.includes(state)}
                onClick={() =>
                  setStates((current) =>
                    current.includes(state)
                      ? current.filter((s) => s !== state)
                      : [...current, state],
                  )
                }
              >
                {STATE_LABEL[state]}
              </Button>
            ))}
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger className="h-9 w-48" aria-label="Trigger">
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
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 w-44" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map((value) => (
                  <SelectItem key={value} value={value}>
                    {categoryLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as AutomationSort)}>
              <SelectTrigger className="h-9 w-44" aria-label="Sort">
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
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {narrowed ? `${visible.length} of ${all.length} rules` : `${all.length} rules`}
            </span>
            {narrowed ? (
              <Button variant="link" size="sm" className="h-auto p-0" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : all.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
              <Workflow className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">No automation rules</p>
              <p className="text-sm text-muted-foreground">
                Start from a recipe in the Library, or create one of your own.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
              <p className="text-sm font-medium">No rule matches these filters</p>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((rule) => (
                <AutomationRuleCard
                  key={rule.id}
                  rule={rule}
                  labels={labels}
                  canEdit={canEdit}
                  busy={update.isPending}
                  onToggle={(enabled) => update.mutate({ id: rule.id, body: { enabled } })}
                  onEdit={() => setEditing(rule)}
                  onDuplicate={() => duplicate.mutate({ id: rule.id })}
                  onHistory={() => setShowing(rule)}
                  onDelete={() => setDeleting(rule)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {editing ? (
        <AutomationFormDialog
          rule={editing}
          open
          labels={labels}
          onOpenChange={(open) => !open && setEditing(undefined)}
        />
      ) : null}
      {creating ? (
        <AutomationFormDialog
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
    </div>
  );
}

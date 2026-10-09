"use client";

import { useId, useMemo, useState } from "react";
import { ArrowDownUp, Plus, Search, X } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSetContactTags } from "@/features/clients/hooks";
import { useClientTags, useCreateClientTag } from "../hooks";
import { activeClientTags, clientTagMap, tagSolidClasses } from "../lib";

/** Workiz's blue words-button ("+ Add tag", "+ Create new"): 13px/19px 500 #3589e9. */
const BLUE = "inline-flex items-center gap-1.5 text-[13px] leading-[19px] font-medium tracking-[0.4px] text-brand outline-none hover:underline focus-visible:underline";

/**
 * Workiz's tags on the client page (pg_contact_wz_269669_01 / _10): a solid
 * chip per tag — 24px, 3px corners, 14px/16px 500 white on the tag's colour,
 * an × inside to take it off — and under them "+ Add tag", which opens
 * Workiz's tag editor: "Available tags (N)" with "+ Create new", "Search tags"
 * and a button that turns the order round, a checkbox per active tag the
 * client does not have yet (each drawn as its chip), and Apply, which puts the
 * ticked ones on.
 */
export function ClientTagsField({
  contactId,
  tagIds,
  canEdit,
  canCreate,
  className,
}: {
  contactId: string;
  tagIds: string[] | undefined;
  /** `contacts.edit`: may put tags on and take them off. */
  canEdit: boolean;
  /** `client_tags.create`: may make a new tag from the editor. */
  canCreate: boolean;
  className?: string;
}) {
  const ids = useMemo(() => tagIds ?? [], [tagIds]);
  const { data: catalog, isLoading } = useClientTags();
  const map = clientTagMap(catalog);
  const setTags = useSetContactTags(contactId);
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const remove = (id: string) => setTags.mutate(ids.filter((x) => x !== id));

  return (
    <div className={cn("flex flex-col items-start", className)}>
      {ids.length ? (
        <div className="flex flex-wrap gap-2">
          {ids.map((id) => {
            const tag = map.get(id);
            if (!tag && isLoading) return <span key={id} className="inline-block h-6 w-16 animate-pulse rounded-[3px] bg-muted" />;
            return (
              <span
                key={id}
                className={cn(
                  "relative inline-flex h-6 max-w-[260px] items-center rounded-[3px] py-1 pl-2 text-sm leading-4 font-medium tracking-[0.4px]",
                  canEdit ? "pr-6" : "pr-2",
                  tag ? tagSolidClasses(tag.color) : "bg-wz-outline text-white",
                )}
                title={tag?.name ?? id}
              >
                <span className="truncate">{tag?.name ?? id}</span>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Remove ${tag?.name ?? id}`}
                    onClick={() => remove(id)}
                    disabled={setTags.isPending}
                    className="absolute top-1/2 right-1 grid size-4 -translate-y-1/2 place-items-center rounded-[2px] hover:bg-white/20"
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}

      {canEdit ? (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button type="button" aria-label="Add tag" className={cn(BLUE, "h-6 pl-[5px]", ids.length ? "mt-5" : "mt-0")}>
              <Plus className="size-4" strokeWidth={1.75} /> Add tag
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              aria-labelledby={titleId}
              align="start"
              sideOffset={12}
              className="z-50 w-[352px] rounded-[8px] bg-white p-4 text-foreground shadow-[0_8px_16px_rgba(59,75,82,0.15),0_0_4px_rgba(59,75,82,0.05)] outline-none"
            >
              {open ? (
                <TagEditor
                  titleId={titleId}
                  catalog={catalog}
                  attached={ids}
                  canCreate={canCreate}
                  pending={setTags.isPending}
                  onApply={(picked) => {
                    if (picked.length) setTags.mutate([...ids, ...picked.filter((p) => !ids.includes(p))], { onSuccess: () => setOpen(false) });
                    else setOpen(false);
                  }}
                />
              ) : null}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </div>
  );
}

function TagEditor({
  titleId,
  catalog,
  attached,
  canCreate,
  pending,
  onApply,
}: {
  titleId: string;
  catalog: Parameters<typeof activeClientTags>[0];
  attached: string[];
  canCreate: boolean;
  pending: boolean;
  onApply: (picked: string[]) => void;
}) {
  const create = useCreateClientTag();
  const [query, setQuery] = useState("");
  const [reversed, setReversed] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const available = activeClientTags(catalog).filter((t) => !attached.includes(t.id));
  const q = query.trim().toLowerCase();
  const shown = (reversed ? [...available].reverse() : available).filter((t) => !q || t.name.toLowerCase().includes(q));
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const makeTag = () => {
    const v = name.trim();
    if (!v) return;
    create.mutate({ name: v, color: "slate" }, { onSuccess: (tag) => onApply([tag.id]) });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h5 id={titleId} className="text-base leading-6 font-semibold tracking-[0.2px]">
          Available tags ({available.length})
        </h5>
        {canCreate ? (
          <button type="button" className={BLUE} onClick={() => setCreating((c) => !c)}>
            <Plus className="size-4" strokeWidth={1.75} /> Create new
          </button>
        ) : null}
      </div>

      {creating ? (
        <div className="mt-4 flex items-center gap-2">
          <input
            aria-label="Tag name"
            placeholder="Tag name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && makeTag()}
            autoFocus
            className="h-10 min-w-0 flex-1 rounded-[4px] border border-wz-outline px-3 text-[13px] leading-4 outline-none placeholder:text-wz-outline focus:border-wz-link"
          />
          <Button className="h-8 rounded-pill px-3" disabled={!name.trim() || create.isPending} onClick={makeTag}>
            Create
          </Button>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-[15px]">
        <div className="relative w-[269px]">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2" aria-hidden />
          <input
            type="search"
            aria-label="Search tags"
            placeholder="Search tags"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 w-full rounded-[4px] border border-wz-outline bg-white pr-3 pl-11 text-[13px] leading-4 outline-none placeholder:text-wz-outline focus:border-wz-link"
          />
        </div>
        <button
          type="button"
          aria-label="Sort tags"
          aria-pressed={reversed}
          onClick={() => setReversed((r) => !r)}
          className="grid size-8 place-items-center rounded-[8px] hover:bg-wz-secondary-hover"
        >
          <ArrowDownUp className="size-5" strokeWidth={1.25} />
        </button>
      </div>

      <ul className="mt-3 max-h-[160px] overflow-y-auto">
        {shown.map((t) => (
          <li key={t.id} className="flex h-8 items-center gap-[18px] pl-2.5">
            <input
              type="checkbox"
              aria-label={t.name}
              checked={picked.includes(t.id)}
              onChange={() => toggle(t.id)}
              className="size-[13px] shrink-0 accent-wz-link"
            />
            <span className={cn("truncate rounded-[4px] px-1 text-[13px] leading-[19px] tracking-[0.4px]", tagSolidClasses(t.color))}>{t.name}</span>
          </li>
        ))}
        {shown.length === 0 ? <li className="py-2 pl-2.5 text-[13px] text-wz-outline-label">No tags</li> : null}
      </ul>

      <div className="mt-4 flex justify-end">
        <Button className="h-8 rounded-pill px-3" disabled={picked.length === 0 || pending} onClick={() => onApply(picked)}>
          Apply
        </Button>
      </div>
    </div>
  );
}

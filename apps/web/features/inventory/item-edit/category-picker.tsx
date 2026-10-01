"use client";

import { useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ChevronLeft, Folder, Info, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { WzButton, WzDialog } from "./wz";

/** BitCRM files a nested category under its full path: "Locks > Residential". */
export const CATEGORY_SEPARATOR = " > ";

export interface CategoryNode {
  /** The full path — what an item stores in `category`. */
  path: string;
  /** The last segment, shown on the tile. */
  name: string;
  children: CategoryNode[];
  /** A catalog row exists for it (an implied parent only navigates). */
  selectable: boolean;
}

/**
 * The catalog's names as a tree. A parent that only exists as the start of a
 * longer name is still a node — it can be opened, not chosen.
 */
export function buildCategoryTree(names: string[]): CategoryNode[] {
  const root: CategoryNode = { path: "", name: "", children: [], selectable: false };
  const byPath = new Map<string, CategoryNode>([["", root]]);
  for (const full of [...new Set(names)].sort((a, b) => a.localeCompare(b))) {
    const parts = full.split(CATEGORY_SEPARATOR);
    let parent = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join(CATEGORY_SEPARATOR);
      let node = byPath.get(path);
      if (!node) {
        node = { path, name: part, children: [], selectable: false };
        byPath.set(path, node);
        parent.children.push(node);
      }
      if (i === parts.length - 1) node.selectable = true;
      parent = node;
    });
  }
  return root.children;
}

function findNode(nodes: CategoryNode[], path: string): CategoryNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (path.startsWith(node.path + CATEGORY_SEPARATOR)) return findNode(node.children, path);
  }
  return undefined;
}

/**
 * Workiz's "Browse" window for "Choose category (optional)": a search box on
 * top, the breadcrumb, then the categories of the level open as tiles.
 * Opening a category also picks it (Workiz: "Items will be associated to main
 * category by default"); a subcategory tile picks that one instead. Apply
 * hands the pick back.
 */
export function CategoryPicker({
  categories,
  value,
  onOpenChange,
  onApply,
}: {
  /** The names that may be chosen (active catalog rows, plus the item's own). */
  categories: string[];
  value: string;
  onOpenChange: (open: boolean) => void;
  onApply: (category: string) => void;
}) {
  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const startLevel = useMemo(() => {
    // Open where the current category lives.
    const parts = value ? value.split(CATEGORY_SEPARATOR) : [];
    const own = findNode(tree, value);
    if (own && own.children.length > 0) return value;
    return parts.slice(0, -1).join(CATEGORY_SEPARATOR);
  }, [tree, value]);
  const [level, setLevel] = useState(startLevel);
  const [picked, setPicked] = useState(value);
  const [search, setSearch] = useState("");

  const current = level ? findNode(tree, level) : undefined;
  const term = search.trim().toLowerCase();
  const tiles: CategoryNode[] = useMemo(() => {
    if (term) {
      const out: CategoryNode[] = [];
      const walk = (nodes: CategoryNode[]) =>
        nodes.forEach((n) => {
          if (n.path.toLowerCase().includes(term)) out.push({ ...n, name: n.path });
          walk(n.children);
        });
      walk(tree);
      return out;
    }
    return current ? current.children : tree;
  }, [term, tree, current]);

  const open = (node: CategoryNode) => {
    if (node.selectable) setPicked(node.path);
    if (node.children.length > 0) {
      setLevel(node.path);
      setSearch("");
    }
  };
  const back = () => {
    const parts = level.split(CATEGORY_SEPARATOR);
    const up = parts.slice(0, -1).join(CATEGORY_SEPARATOR);
    setLevel(up);
  };
  const crumbs = ["Categories", ...(level ? level.split(CATEGORY_SEPARATOR) : [])];

  return (
    <WzDialog
      open
      onOpenChange={onOpenChange}
      testId="category-picker"
      className="flex h-[min(768px,calc(100dvh-2rem))] w-[1024px] flex-col overflow-hidden"
    >
      <DialogPrimitive.Title className="sr-only">Choose category</DialogPrimitive.Title>
      <div className="relative flex-none px-12 pt-[14px] sm:px-6">
        <label className="relative mx-auto block w-full max-w-[543px] min-w-0">
          <span className="sr-only">Search categories</span>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search categories"
            className="block h-12 w-full min-w-0 rounded-[4px] border border-[#ccc] bg-white pr-10 pl-2.5 text-[16px] leading-4 tracking-[0.4px] text-[#666] outline-none placeholder:text-[#8c8c8c] focus:border-[#ffd400]"
          />
          <Search className="pointer-events-none absolute top-1/2 right-3 size-[18px] -translate-y-1/2 text-[#3b4b52]" />
        </label>
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute top-[29px] right-6 text-[#3b4b52] hover:opacity-70"
        >
          <X className="size-[18px]" strokeWidth={2.25} />
        </DialogPrimitive.Close>
      </div>

      <nav
        aria-label="Breadcrumb"
        className="mx-6 mt-3 flex-none truncate bg-[#f3f6f7] px-2.5 text-[11px] leading-6 tracking-[0.4px] text-[#3b4b52]"
      >
        {crumbs.join("›")}
      </nav>
      <p className="mx-6 mt-4 flex flex-none items-center gap-3 text-[13px] leading-[19px] tracking-[0.4px] text-[#3b4b52]">
        <Info className="size-4 flex-none" strokeWidth={1.5} />
        Note: Items will be associated to main category by default
      </p>
      <div className="mx-6 mt-6 flex min-w-0 flex-none items-center gap-3">
        {level && !term ? (
          <button type="button" aria-label="Back" onClick={back} className="text-[#3b4b52] hover:opacity-70">
            <ChevronLeft className="size-5" strokeWidth={1.75} />
          </button>
        ) : null}
        <h3 className="min-w-0 truncate text-[18px] leading-[27px] font-semibold tracking-[0.4px] text-[#3b4b52]">
          {term ? "Search results" : current ? current.name : "Categories"}
        </h3>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pt-4 pb-6">
        {tiles.length === 0 ? (
          <p className="py-10 text-center text-[14px] text-[#8c8c8c]">No categories</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-x-11 gap-y-6">
            {tiles.map((node) => {
              const selected = picked === node.path;
              return (
                <li key={node.path} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={node.path}
                    onClick={() => open(node)}
                    className="group block w-full min-w-0 text-left outline-none"
                  >
                    <span
                      className={cn(
                        "flex aspect-square w-full items-center justify-center rounded-[4px] bg-[#f3f6f7] text-[#b4bbbd] ring-offset-2 transition-shadow group-hover:ring-2 group-hover:ring-[#e5e6ea] group-focus-visible:ring-2 group-focus-visible:ring-[#ffd400]",
                        selected && "ring-2 ring-[#fad400] group-hover:ring-[#fad400]",
                      )}
                    >
                      <Folder className="size-10" strokeWidth={1.25} />
                    </span>
                    <span className="mt-2 block truncate text-[13px] leading-[19px] tracking-[0.4px] text-[#3b4b52]">
                      {node.name}
                    </span>
                    <span className="block truncate text-[12px] leading-[18px] text-[#8c8c8c]">
                      {node.children.length > 0
                        ? `${node.children.length} subcategor${node.children.length === 1 ? "y" : "ies"}`
                        : " "}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex h-14 flex-none items-center justify-between gap-4 bg-[#f3f6f7] px-6">
        <WzButton variant="tertiary" className="px-0 hover:bg-transparent" onClick={() => onOpenChange(false)}>
          Cancel
        </WzButton>
        <WzButton disabled={!picked} onClick={() => onApply(picked)}>
          Apply
        </WzButton>
      </div>
    </WzDialog>
  );
}

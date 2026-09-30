"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { Info, Loader2, PackageSearch, Search, X } from "lucide-react";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplate } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogLoadingBody } from "@/features/inventory/components/dialog-loading";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { usePermissions } from "@/features/auth/use-permissions";
import { listProducts } from "@/features/inventory/products/api";
import type { UpdateTemplateBody } from "../api";
import { useContainerTemplate, useCreateTemplate, useUpdateTemplate } from "../hooks";
import { addLine, checkLineQuantity, type DraftLine } from "../lib";

/**
 * A template — a van's ideal loadout — in a popup: its name, a description,
 * and the products with the quantity of each a van should carry. `null` is a
 * new one.
 */
export function TemplateDialog({
  templateId,
  open,
  onOpenChange,
}: {
  templateId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can, isLoading: permsLoading } = usePermissions();
  const query = useContainerTemplate(templateId ?? undefined, open && !!templateId);
  const close = () => onOpenChange(false);
  // Until the permissions answer, the form is drawn whole and editable-shaped,
  // but disabled: a "no permission" stub (or a view-only banner) that the
  // answer then replaced grew the popup and pushed the form about.
  const pending = !!permsLoading;

  let content: ReactNode;
  if (!templateId) {
    content = pending || can("containers", "create") ? (
      <TemplateForm readOnly={false} pending={pending} onClose={close} />
    ) : (
      <>
        <Header title="New template" description="You don't have permission to create templates." />
        <Footer>
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </Footer>
      </>
    );
  } else if (query.isLoading) {
    content = (
      <>
        <Header title="Template" />
        <DialogLoadingBody testId="template-loading" fields={["input", "area", "panel"]} />
      </>
    );
  } else if (query.isError || !query.data) {
    content = (
      <>
        <Header title="Template not found" description="It may have been deleted." />
        <Footer>
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </Footer>
      </>
    );
  } else {
    // Keyed by the save time: a fresh copy starts a fresh form.
    content = (
      <TemplateForm
        key={query.data.updatedAt}
        template={query.data}
        readOnly={!pending && !can("containers", "edit")}
        pending={pending}
        onClose={close}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Header and footer stay put; the form scrolls between them. A
          // template's popup is one height loading and loaded: 494px growing
          // to 968px moved its top from 253px to 16px. A new one starts empty
          // and grows only as lines are added.
          "flex flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl",
          templateId ? "h-[min(61rem,calc(100dvh-2rem))]" : "max-h-[calc(100dvh-2rem)]",
        )}
      >
        {content}
      </DialogContent>
    </Dialog>
  );
}

function TemplateForm({
  template,
  readOnly,
  pending = false,
  onClose,
}: {
  template?: ContainerTemplate;
  readOnly: boolean;
  /** The permissions are still loading: the editable form, every control off. */
  pending?: boolean;
  onClose: () => void;
}) {
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const saving = create.isPending || update.isPending;
  const ids = useId();

  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    () =>
      template?.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        quantity: String(i.quantity),
      })) ?? [],
  );

  // Adding a product focuses its quantity — a new line's, or the one already there.
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!focus) return;
    const input = inputs.current.get(focus.id);
    input?.focus();
    input?.select();
  }, [focus]);

  const checks = lines.map((l) => checkLineQuantity(l.quantity));
  const valid = name.trim().length > 0 && lines.length > 0 && checks.every((c) => c.quantity !== null);
  const items = lines.map((l, i) => ({ productId: l.productId, quantity: checks[i].quantity ?? 0 }));

  // Nothing to press or type into until the permissions answer.
  const locked = readOnly || pending;

  const save = () => {
    if (!valid || locked) return;
    const text = description.trim();
    if (!template) {
      create.mutate(
        { name: name.trim(), ...(text ? { description: text } : {}), items },
        { onSuccess: onClose },
      );
      return;
    }
    const unchanged =
      name.trim() === template.name &&
      text === (template.description ?? "").trim() &&
      items.length === template.items.length &&
      items.every((it, i) => it.productId === template.items[i].productId && it.quantity === template.items[i].quantity);
    if (unchanged) return onClose();
    const body: UpdateTemplateBody = { name: name.trim(), items };
    if (text) body.description = text;
    else if (template.description) body.description = null;
    update.mutate({ id: template.id, body }, { onSuccess: onClose });
  };

  const archived = template?.status === InventoryStatus.ARCHIVED;
  const title = !template ? "New template" : readOnly ? "Template" : "Edit template";

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Header title={title} description={archived ? "Archived — restore it from the list to use it again." : undefined} />
      <div data-testid="template-body" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {readOnly ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            <Info className="size-4" />
            You have view-only access to templates.
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-name`}>Name</Label>
          <Input
            id={`${ids}-name`}
            className="h-10"
            disabled={locked}
            value={name}
            placeholder="Standard van"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-desc`}>Description</Label>
          <Textarea
            id={`${ids}-desc`}
            rows={2}
            disabled={locked}
            value={description}
            placeholder="Optional"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="space-y-2 rounded-lg bg-muted/60 p-3">
          <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Products · target quantity
          </div>
          {!readOnly ? (
            <ProductSearch
              disabled={pending}
              onPick={(p) => {
                const next = addLine(lines, p);
                setLines(next.lines);
                setFocus((f) => ({ id: next.focus, n: (f?.n ?? 0) + 1 }));
              }}
            />
          ) : null}

          {lines.length === 0 ? (
            <p className="rounded-md border border-dashed bg-background px-3 py-6 text-center text-sm text-muted-foreground">
              No products yet — search to add the first one.
            </p>
          ) : (
            <ul className="divide-y rounded-md border bg-background">
              {lines.map((l, i) => (
                <li key={l.productId} data-line={l.productId} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.productName}</div>
                    {l.sku ? <div className="truncate font-mono text-xs text-muted-foreground">{l.sku}</div> : null}
                  </div>
                  <div className="flex flex-none flex-col items-start gap-0.5">
                    <Input
                      ref={(el) => {
                        if (el) inputs.current.set(l.productId, el);
                        else inputs.current.delete(l.productId);
                      }}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      aria-label={`Quantity of ${l.productName}`}
                      aria-invalid={checks[i].error ? true : undefined}
                      disabled={locked}
                      value={l.quantity}
                      onChange={(e) =>
                        setLines((all) =>
                          all.map((x) => (x.productId === l.productId ? { ...x, quantity: e.target.value } : x)),
                        )
                      }
                      className="h-9 w-24 tabular-nums"
                    />
                    {checks[i].error && l.quantity.trim() !== "" ? (
                      <span className="text-xs text-destructive">{checks[i].error}</span>
                    ) : null}
                  </div>
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 flex-none"
                      disabled={pending}
                      aria-label={`Remove ${l.productName}`}
                      onClick={() => setLines((all) => all.filter((x) => x.productId !== l.productId))}
                    >
                      <X />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Footer>
        {readOnly ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || locked || saving} className="gap-1.5">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </>
        )}
      </Footer>
    </form>
  );
}

/**
 * Finds a stock-managed item on the server, as typed — the catalog is
 * thousands of items, too many to page into the browser.
 *
 * The results open in a portalled popover anchored to the box, the way
 * `LocationPicker` does it: drawn inside the popup's scrolling body they were
 * cut off by it and hidden behind the footer. The last results stay while
 * the next search runs, instead of blinking to "Searching…" per keystroke.
 */
function ProductSearch({
  onPick,
  disabled = false,
}: {
  onPick: (p: { id: string; name: string; sku?: string }) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const term = useDebouncedValue(text.trim(), 300);
  const listId = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const results = useQuery({
    queryKey: ["template-product-search", term],
    queryFn: () =>
      listProducts({ manageStock: true, status: InventoryStatus.ACTIVE, search: term }, undefined, 10),
    enabled: term.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const found = results.data?.data ?? [];
  const showing = open && text.trim().length > 0 && term.length > 0;

  const pick = (p: { id: string; name: string; sku?: string }) => {
    onPick({ id: p.id, name: p.name, sku: p.sku });
    setText("");
    setOpen(false);
  };

  return (
    <Popover.Root open={showing} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div ref={anchor} className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Add a product"
            aria-controls={listId}
            aria-expanded={showing}
            placeholder="Search items by name or SKU to add"
            disabled={disabled}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              // Down from the box walks into the results.
              if (e.key === "ArrowDown" && showing) {
                e.preventDefault();
                document.getElementById(listId)?.querySelector<HTMLElement>("[role=option]")?.focus();
              }
            }}
            className="h-9 bg-background pl-8"
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          id={listId}
          role="listbox"
          aria-label="Products"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          // Typing goes on in the box: opening must not take the focus away…
          onOpenAutoFocus={(e) => e.preventDefault()}
          // …and a click in the box is not a click outside the list.
          onInteractOutside={(e) => {
            if (anchor.current?.contains(e.target as Node)) e.preventDefault();
          }}
          className="z-50 max-h-[min(16rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-md"
        >
          {results.isLoading && !results.data ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">Searching…</div>
          ) : found.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <PackageSearch className="size-4" />
              No stock-managed item matches.
            </div>
          ) : (
            found.map((p) => (
              <div
                key={p.id}
                role="option"
                aria-selected={false}
                tabIndex={0}
                onClick={() => pick(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(p);
                  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const sibling =
                      e.key === "ArrowDown"
                        ? e.currentTarget.nextElementSibling
                        : e.currentTarget.previousElementSibling;
                    (sibling as HTMLElement | null)?.focus();
                  }
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                  results.isPlaceholderData && "opacity-70",
                )}
              >
                <span className="w-14 flex-none tabular-nums text-muted-foreground">{p.number ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="flex-none font-mono text-xs text-muted-foreground">{p.sku}</span>
              </div>
            ))
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Header({ title, description }: { title: string; description?: string }) {
  return (
    // Right padding keeps the title clear of the close button.
    <DialogHeader className="border-b px-4 py-3 pr-12">
      <DialogTitle className="text-base">{title}</DialogTitle>
      <DialogDescription className={description ? undefined : "sr-only"}>
        {description ?? "A van's ideal loadout: products and how many of each."}
      </DialogDescription>
    </DialogHeader>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <DialogFooter className="m-0 flex-none">{children}</DialogFooter>;
}

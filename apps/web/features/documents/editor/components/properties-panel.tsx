"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Loader2, Minus, MousePointerClick, Plus, Trash2 } from "lucide-react";
import type {
  BlockStyle,
  DocumentBlock,
  DocumentColumn,
  DocumentRow,
  ItemsTableBlock,
  TableBlock,
  TotalsBlock,
} from "@bitcrm/types";
import { LIMITS } from "@bitcrm/document-renderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useBusinessProfile, useUploadAsset } from "../../hooks";
import { ROW_LAYOUTS, mergeTagLabel, mergeTagsForKind, spansLabel } from "../../lib";
import { IMAGE_TYPES } from "../../schemas";
import { blockTool } from "../catalog";
import { emptyDoc } from "../rich-text";
import { useEditorStore } from "../store";
import { getBlock, getRow, type BlockPatch } from "../tree";
import { ALIGN_OPTIONS, ColorField, FieldRow, NumberField, PanelSection, Segmented, SwitchRow } from "./controls";
import { LayoutGlyph } from "./layout-glyph";
import { reportResult } from "./report";

const PADDINGS = [
  ["paddingTop", "Top"],
  ["paddingRight", "Right"],
  ["paddingBottom", "Bottom"],
  ["paddingLeft", "Left"],
] as const;

function TextField({ label, value, onChange, placeholder, maxLength = LIMITS.maxLabelLength }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number }) {
  const id = `prop-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <FieldRow label={label} htmlFor={id}>
      <Input id={id} className="h-8 text-xs" value={value} placeholder={placeholder} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </FieldRow>
  );
}

/* ------------------------------------------------------------------ style */

function StyleSection({ style, onChange, title = "Style", withText = true }: { style: BlockStyle | undefined; onChange: (patch: BlockStyle, key: string) => void; title?: string; withText?: boolean }) {
  const s = style ?? {};
  return (
    <>
      <PanelSection title={title}>
        {withText ? (
          <>
            <FieldRow label="Alignment">
              <Segmented label="Alignment" value={s.align ?? "left"} options={ALIGN_OPTIONS} onChange={(align) => onChange({ align }, "align")} />
            </FieldRow>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Font size" value={s.fontSize} allowEmpty placeholder="Auto" min={LIMITS.minFontSize} max={LIMITS.maxFontSize} suffix="px" onChange={(fontSize) => onChange({ fontSize }, "fontSize")} />
              <FieldRow label="Weight">
                <Segmented
                  label="Weight"
                  value={s.fontWeight ?? "normal"}
                  options={[
                    { value: "normal", label: "Regular" },
                    { value: "bold", label: "Bold" },
                  ]}
                  onChange={(fontWeight) => onChange({ fontWeight }, "fontWeight")}
                />
              </FieldRow>
            </div>
            <ColorField label="Text color" value={s.color} allowEmpty onChange={(color) => onChange({ color }, "color")} />
          </>
        ) : null}
        <ColorField label="Background" value={s.background} allowEmpty placeholder="None" onChange={(background) => onChange({ background }, "background")} />
      </PanelSection>
      <PanelSection title="Spacing & border">
        <div className="grid grid-cols-2 gap-2">
          {PADDINGS.map(([key, label]) => (
            <NumberField key={key} label={`Padding ${label.toLowerCase()}`} value={s[key]} allowEmpty placeholder="0" min={0} max={LIMITS.maxPadding} suffix="px" onChange={(v) => onChange({ [key]: v }, key)} />
          ))}
          <NumberField label="Border width" value={s.borderWidth} allowEmpty placeholder="0" min={0} max={LIMITS.maxBorderWidth} suffix="px" onChange={(borderWidth) => onChange({ borderWidth }, "borderWidth")} />
          <NumberField label="Corner radius" value={s.borderRadius} allowEmpty placeholder="0" min={0} max={LIMITS.maxBorderRadius} suffix="px" onChange={(borderRadius) => onChange({ borderRadius }, "borderRadius")} />
        </div>
        <ColorField label="Border color" value={s.borderColor} allowEmpty placeholder="#d1d5db" onChange={(borderColor) => onChange({ borderColor }, "borderColor")} />
      </PanelSection>
    </>
  );
}

/* -------------------------------------------------------------------- row */

function ColumnSpans({ row }: { row: DocumentRow }) {
  const current = row.columns.map((c) => c.span);
  const [spans, setSpans] = useState<number[] | null>(null);
  const shown = spans && spans.length === current.length ? spans : current;
  const sum = shown.reduce((a, b) => a + b, 0);
  const changed = shown.join() !== current.join();

  return (
    <PanelSection title="Columns">
      <div className="grid grid-cols-3 gap-1.5">
        {ROW_LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            title={l.label}
            aria-label={`Layout ${l.label}`}
            aria-pressed={spansLabel(l.spans) === spansLabel(current)}
            onClick={() => {
              setSpans(null);
              reportResult(useEditorStore.getState().setRowLayout(row.id, l.spans));
            }}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md border p-1.5 text-[10px] text-muted-foreground hover:border-amber-400",
              spansLabel(l.spans) === spansLabel(current) && "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-400/10",
            )}
          >
            <LayoutGlyph spans={l.spans} className="w-full" />
            {spansLabel(l.spans)}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-1.5">
        {shown.map((s, i) => (
          <NumberField
            key={i}
            className="min-w-0 flex-1"
            label={`Col ${i + 1}`}
            value={s}
            min={1}
            max={12}
            onChange={(v) => v !== undefined && setSpans(shown.map((x, j) => (j === i ? v : x)))}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-[11px]", sum === 12 ? "text-muted-foreground" : "text-destructive")}>Total {sum} / 12</span>
        <Button
          size="xs"
          variant="outline"
          disabled={!changed || sum !== 12}
          onClick={() => {
            if (reportResult(useEditorStore.getState().setRowLayout(row.id, shown))) setSpans(null);
          }}
        >
          Apply widths
        </Button>
      </div>
    </PanelSection>
  );
}

function ColumnAlign({ column, index }: { column: DocumentColumn; index: number }) {
  return (
    <FieldRow label={`Column ${index + 1}`}>
      <Segmented
        label={`Column ${index + 1} vertical alignment`}
        value={column.verticalAlign ?? "top"}
        options={[
          { value: "top", label: "Top" },
          { value: "middle", label: "Middle" },
          { value: "bottom", label: "Bottom" },
        ]}
        onChange={(verticalAlign) => useEditorStore.getState().updateColumn(column.id, { verticalAlign })}
      />
    </FieldRow>
  );
}

function RowProperties({ row }: { row: DocumentRow }) {
  const st = useEditorStore.getState;
  return (
    <>
      <ColumnSpans key={row.columns.map((c) => c.span).join()} row={row} />
      <PanelSection title="Vertical alignment">
        {row.columns.map((c, i) => (
          <ColumnAlign key={c.id} column={c} index={i} />
        ))}
      </PanelSection>
      <PanelSection title="Row">
        <NumberField label="Gap between columns" value={row.gap ?? 16} min={0} max={LIMITS.maxRowGap} suffix="px" onChange={(gap) => st().updateRow(row.id, { gap }, { coalesce: `row-gap:${row.id}` })} />
      </PanelSection>
      <StyleSection
        style={row.style}
        title="Row style"
        onChange={(style, key) => st().updateRow(row.id, { style }, { coalesce: `row-style:${row.id}:${key}` })}
      />
    </>
  );
}

/* ----------------------------------------------------------------- blocks */

type Update = (patch: BlockPatch, key?: string) => void;

function ImageOptions({ block, update }: { block: Extract<DocumentBlock, { type: "image" }>; update: Update }) {
  const upload = useUploadAsset();
  const input = useRef<HTMLInputElement>(null);
  return (
    <PanelSection title="Image">
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        aria-label="Choose image"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file, { onSuccess: (assetId) => update({ assetId }) });
        }}
      />
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" className="flex-1 gap-1" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? <Loader2 className="animate-spin" /> : <ImagePlus />}
          {block.assetId ? "Replace image" : "Upload image"}
        </Button>
        {block.assetId ? (
          <Button variant="ghost" size="icon-sm" aria-label="Remove image" onClick={() => update({ assetId: undefined })}>
            <Trash2 />
          </Button>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">PNG, JPEG or WebP, up to 5 MB.</p>
      <NumberField label="Width" value={block.widthPercent} min={10} max={100} suffix="%" onChange={(v) => v !== undefined && update({ widthPercent: v }, "width")} />
      <TextField label="Alt text" value={block.alt ?? ""} placeholder="Describe the image" onChange={(alt) => update({ alt: alt || undefined }, "alt")} />
    </PanelSection>
  );
}

function LogoOptions({ block, update }: { block: Extract<DocumentBlock, { type: "logo" }>; update: Update }) {
  const { data: profile } = useBusinessProfile();
  return (
    <PanelSection title="Logo">
      <NumberField label="Max height" value={block.maxHeight} min={LIMITS.minLogoHeight} max={LIMITS.maxLogoHeight} suffix="px" onChange={(v) => v !== undefined && update({ maxHeight: v }, "maxHeight")} />
      <p className="text-[11px] text-muted-foreground">
        {profile?.logoAssetId
          ? "Uses the logo of the job's company (the default company in previews)."
          : "The default company has no logo yet."}{" "}
        <Link href="/settings/companies" target="_blank" className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2">
          Companies <ExternalLink className="size-3" />
        </Link>
      </p>
    </PanelSection>
  );
}

function TableOptions({ block, update }: { block: TableBlock; update: Update }) {
  const rows = block.rows.length;
  const cols = block.rows[0]?.length ?? 0;
  // Changing the column count resets custom widths (they must match the columns).
  const setRows = (next: TableBlock["rows"], columnWidths: number[] | undefined) => update({ rows: next, columnWidths });

  const addRow = () => setRows([...block.rows, Array.from({ length: Math.max(1, cols) }, emptyDoc)], block.columnWidths);
  const removeRow = () => setRows(block.rows.slice(0, -1), block.columnWidths);
  const addCol = () => setRows(block.rows.map((r) => [...r, emptyDoc()]), undefined);
  const removeCol = () => setRows(block.rows.map((r) => r.slice(0, -1)), undefined);

  const widths = block.columnWidths ?? Array.from({ length: cols }, () => Math.round(100 / Math.max(1, cols)));

  return (
    <PanelSection title="Table">
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label={`Rows (${rows})`}>
          <div className="flex gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Remove row" disabled={rows <= 1} onClick={removeRow}>
              <Minus />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Add row" disabled={rows >= LIMITS.maxTableRows} onClick={addRow}>
              <Plus />
            </Button>
          </div>
        </FieldRow>
        <FieldRow label={`Columns (${cols})`}>
          <div className="flex gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Remove column" disabled={cols <= 1} onClick={removeCol}>
              <Minus />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Add column" disabled={cols >= LIMITS.maxTableColumns} onClick={addCol}>
              <Plus />
            </Button>
          </div>
        </FieldRow>
      </div>
      <SwitchRow label="Header row" checked={block.headerRow} onChange={(headerRow) => update({ headerRow })} />
      <SwitchRow label="Borders" checked={block.bordered} onChange={(bordered) => update({ bordered })} />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Column widths</span>
          {block.columnWidths ? (
            <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => update({ columnWidths: undefined })}>
              Auto
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {widths.map((w, i) => (
            <NumberField
              key={i}
              label={`Col ${i + 1}`}
              value={block.columnWidths ? w : undefined}
              placeholder={String(w)}
              allowEmpty
              min={1}
              max={100}
              suffix="%"
              onChange={(v) => {
                if (v === undefined) return;
                update({ columnWidths: widths.map((x, j) => (j === i ? v : x)) }, `width:${i}`);
              }}
            />
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Click a cell on the page to edit its text.</p>
    </PanelSection>
  );
}

function FieldOptions({ block, update }: { block: Extract<DocumentBlock, { type: "field" }>; update: Update }) {
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const groups = mergeTagsForKind(kind, "");
  const known = groups.some((g) => g.tags.some((t) => t.path === block.path));
  return (
    <PanelSection title="Field">
      <FieldRow label="Value">
        <Select value={block.path} onValueChange={(path) => path && update({ path, label: block.label === mergeTagLabel(block.path) ? mergeTagLabel(path) : block.label })}>
          <SelectTrigger className="h-8 w-full text-xs" aria-label="Value">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {!known ? <SelectItem value={block.path}>{mergeTagLabel(block.path)}</SelectItem> : null}
            {groups.map((g) => (
              <SelectGroup key={g.id}>
                <SelectLabel>{g.label}</SelectLabel>
                {g.tags.map((t) => (
                  <SelectItem key={t.path} value={t.path}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      <TextField label="Label" value={block.label ?? ""} placeholder="No label" onChange={(label) => update({ label: label || undefined }, "label")} />
      <SwitchRow label="Hide when empty" checked={!!block.hideIfEmpty} onChange={(hideIfEmpty) => update({ hideIfEmpty })} />
    </PanelSection>
  );
}

function ItemsTableOptions({ block, update }: { block: ItemsTableBlock; update: Update }) {
  const setColumns = (columns: ItemsTableBlock["columns"], key?: string) => update({ columns }, key);
  const move = (i: number, d: -1 | 1) => {
    const next = [...block.columns];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setColumns(next);
  };
  return (
    <>
      <PanelSection title="Columns">
        <p className="text-[11px] text-muted-foreground">“Client visibility” can hide some columns for every block.</p>
        <ul className="space-y-1.5">
          {block.columns.map((c, i) => (
            <li key={c.key} className="flex items-center gap-1">
              <Input
                aria-label={`${c.key} column label`}
                className="h-7 min-w-0 flex-1 text-xs"
                value={c.label}
                maxLength={60}
                onChange={(e) => setColumns(block.columns.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)), `col-label:${c.key}`)}
              />
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${c.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${c.label} down`} disabled={i === block.columns.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown />
              </Button>
              <input
                type="checkbox"
                className="size-3.5 accent-amber-500"
                aria-label={`Show ${c.label}`}
                checked={c.visible}
                disabled={c.key === "name"}
                onChange={(e) => setColumns(block.columns.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x)))}
              />
            </li>
          ))}
        </ul>
      </PanelSection>
      <PanelSection title="Table style">
        <ColorField label="Header background" value={block.headerBackground} allowEmpty placeholder="Accent color" onChange={(headerBackground) => update({ headerBackground }, "headerBackground")} />
        <ColorField label="Header text" value={block.headerColor} allowEmpty placeholder="#ffffff" onChange={(headerColor) => update({ headerColor }, "headerColor")} />
        <SwitchRow label="Striped rows" checked={block.striped} onChange={(striped) => update({ striped })} />
      </PanelSection>
    </>
  );
}

const TOTALS_TOGGLES: { key: keyof TotalsBlock; label: string; hint?: string }[] = [
  { key: "showSubtotal", label: "Subtotal" },
  { key: "showDiscount", label: "Discount", hint: "Only when there is one" },
  { key: "showTax", label: "Tax", hint: "Only when there is tax" },
  { key: "showPaid", label: "Paid", hint: "Invoices with payments" },
  { key: "showBalance", label: "Balance due", hint: "Invoices only" },
];

function TotalsOptions({ block, update }: { block: TotalsBlock; update: Update }) {
  return (
    <PanelSection title="Totals">
      {TOTALS_TOGGLES.map((t) => (
        <SwitchRow key={t.key} label={t.label} hint={t.hint} checked={block[t.key] !== false} onChange={(v) => update({ [t.key]: v })} />
      ))}
      <TextField label="Total label" value={block.totalLabel ?? ""} placeholder="Total" onChange={(totalLabel) => update({ totalLabel: totalLabel || undefined }, "totalLabel")} />
    </PanelSection>
  );
}

function TypeOptions({ block, update }: { block: DocumentBlock; update: Update }) {
  switch (block.type) {
    case "text":
      return (
        <PanelSection title="Text">
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <MousePointerClick className="mt-0.5 size-3.5 flex-none" />
            Type directly on the page. Use the toolbar above the page for formatting and values.
          </p>
        </PanelSection>
      );
    case "image":
      return <ImageOptions block={block} update={update} />;
    case "logo":
      return <LogoOptions block={block} update={update} />;
    case "divider":
      return (
        <PanelSection title="Divider">
          <NumberField label="Thickness" value={block.thickness} min={1} max={LIMITS.maxDividerThickness} suffix="px" onChange={(v) => v !== undefined && update({ thickness: v }, "thickness")} />
          <FieldRow label="Line style">
            <Segmented
              label="Line style"
              value={block.lineStyle}
              options={[
                { value: "solid", label: "Solid" },
                { value: "dashed", label: "Dashed" },
                { value: "dotted", label: "Dotted" },
              ]}
              onChange={(lineStyle) => update({ lineStyle })}
            />
          </FieldRow>
        </PanelSection>
      );
    case "spacer":
      return (
        <PanelSection title="Spacer">
          <NumberField label="Height" value={block.height} min={0} max={LIMITS.maxSpacerHeight} suffix="px" onChange={(v) => v !== undefined && update({ height: v }, "height")} />
        </PanelSection>
      );
    case "table":
      return <TableOptions block={block} update={update} />;
    case "field":
      return <FieldOptions block={block} update={update} />;
    case "itemsTable":
      return <ItemsTableOptions block={block} update={update} />;
    case "totals":
      return <TotalsOptions block={block} update={update} />;
    case "signature":
      return (
        <PanelSection title="Signature">
          <TextField label="Label" value={block.label} onChange={(label) => update({ label }, "label")} />
          <SwitchRow label="Show date line" checked={block.showDate} onChange={(showDate) => update({ showDate })} />
        </PanelSection>
      );
    case "notes":
      return (
        <PanelSection title="Notes">
          <TextField label="Title" value={block.title ?? ""} placeholder="No title" onChange={(title) => update({ title: title || undefined }, "title")} />
          <p className="text-[11px] text-muted-foreground">Shows the notes written on each invoice or estimate.</p>
        </PanelSection>
      );
    case "pageBreak":
      return (
        <PanelSection title="Page break">
          <p className="text-xs text-muted-foreground">Content after this block starts on a new page in the PDF.</p>
        </PanelSection>
      );
    default:
      return null;
  }
}

const NO_TEXT_STYLE = new Set(["spacer", "pageBreak", "divider", "image", "logo"]);

function BlockProperties({ block }: { block: DocumentBlock }) {
  const update: Update = (patch, key) =>
    reportResult(useEditorStore.getState().updateBlock(block.id, patch, key ? { coalesce: `${key}:${block.id}` } : undefined));
  return (
    <>
      <TypeOptions block={block} update={update} />
      {block.type !== "pageBreak" ? (
        <StyleSection
          style={block.style}
          withText={!NO_TEXT_STYLE.has(block.type)}
          onChange={(style, key) => update({ style }, `style-${key}`)}
        />
      ) : null}
      {block.type === "divider" || block.type === "image" || block.type === "logo" ? (
        <PanelSection title="Alignment & color">
          <Segmented label="Alignment" value={block.style?.align ?? "left"} options={ALIGN_OPTIONS} onChange={(align) => update({ style: { align } })} />
          {block.type === "divider" ? (
            <ColorField label="Line color" value={block.style?.color} allowEmpty onChange={(color) => update({ style: { color } }, "style-color")} />
          ) : null}
        </PanelSection>
      ) : null}
    </>
  );
}

/** Right sidebar: properties of the selected row or block. */
export function PropertiesPanel() {
  const selection = useEditorStore((s) => s.selection);
  const target = useEditorStore((s) => {
    const content = s.draft?.content;
    if (!content || !s.selection) return null;
    return s.selection.type === "block" ? getBlock(content, s.selection.id) : getRow(content, s.selection.id);
  });

  if (!selection || !target) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <MousePointerClick className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Nothing selected</p>
        <p className="text-xs text-muted-foreground">Click a block or a row on the page to change its settings.</p>
      </div>
    );
  }

  const isBlock = selection.type === "block";
  const title = isBlock ? `${blockTool((target as DocumentBlock).type).label} block` : "Row";
  const st = useEditorStore.getState;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        <div className="flex gap-0.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => reportResult(isBlock ? st().duplicateBlock(selection.id) : st().duplicateRow(selection.id))}
          >
            Duplicate
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete ${title.toLowerCase()}`}
            onClick={() => (isBlock ? st().removeBlock(selection.id) : st().removeRow(selection.id))}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isBlock ? <BlockProperties key={selection.id} block={target as DocumentBlock} /> : <RowProperties key={selection.id} row={target as DocumentRow} />}
      </div>
    </div>
  );
}

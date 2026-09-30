"use client";

import { useState } from "react";
import type { DocumentPageSettings } from "@bitcrm/types";
import { FONT_STACKS, LIMITS, type DocumentPresetId } from "@bitcrm/document-renderer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PresetPicker } from "../../components/preset-picker";
import { useEditorStore } from "../store";
import { ColorField, FieldRow, NumberField, PanelSection, Segmented } from "./controls";

const FONT_FAMILIES = Object.keys(FONT_STACKS) as DocumentPageSettings["fontFamily"][];
const MARGINS = [
  ["marginTop", "Top"],
  ["marginRight", "Right"],
  ["marginBottom", "Bottom"],
  ["marginLeft", "Left"],
] as const;

export function DesignPanel() {
  const page = useEditorStore((s) => s.draft?.content.page);
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const [preset, setPreset] = useState<DocumentPresetId | null>(null);
  if (!page) return null;

  const update = (patch: Partial<DocumentPageSettings>, key?: string) =>
    useEditorStore.getState().updatePage(patch, key ? { coalesce: `page:${key}` } : undefined);

  return (
    <>
      <PanelSection title="Start from a layout">
        <p className="text-xs text-muted-foreground">Replaces the current rows and blocks. Page settings are reset too.</p>
        <PresetPicker kind={kind} value={undefined} onChange={setPreset} columns={1} label="Layout presets" />
      </PanelSection>

      <PanelSection title="Page">
        <FieldRow label="Paper size">
          <Segmented
            label="Paper size"
            value={page.size}
            onChange={(size) => update({ size })}
            options={[
              { value: "letter", label: "Letter" },
              { value: "a4", label: "A4" },
            ]}
          />
        </FieldRow>
        <div className="grid grid-cols-2 gap-2">
          {MARGINS.map(([key, label]) => (
            <NumberField
              key={key}
              label={`${label} margin`}
              value={page[key]}
              min={0}
              max={LIMITS.maxMarginMm}
              suffix="mm"
              onChange={(v) => v !== undefined && update({ [key]: v }, key)}
            />
          ))}
        </div>
        <ColorField label="Page background" value={page.background} allowEmpty placeholder="#ffffff" onChange={(background) => update({ background }, "background")} />
      </PanelSection>

      <PanelSection title="Typography">
        <FieldRow label="Font">
          <Select value={page.fontFamily} onValueChange={(v) => v && update({ fontFamily: v as DocumentPageSettings["fontFamily"] })}>
            <SelectTrigger className="h-8 w-full text-xs" aria-label="Font">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_FAMILIES.map((f) => (
                <SelectItem key={f} value={f}>
                  <span style={{ fontFamily: FONT_STACKS[f] }}>{f}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <NumberField
          label="Base font size"
          value={page.baseFontSize}
          min={LIMITS.minBaseFontSize}
          max={LIMITS.maxBaseFontSize}
          step={0.5}
          suffix="px"
          onChange={(v) => v !== undefined && update({ baseFontSize: v }, "baseFontSize")}
        />
        <ColorField label="Text color" value={page.textColor} onChange={(textColor) => textColor && update({ textColor }, "textColor")} />
        <ColorField label="Accent color" value={page.accentColor} onChange={(accentColor) => accentColor && update({ accentColor }, "accentColor")} />
      </PanelSection>

      <AlertDialog open={preset !== null} onOpenChange={(o) => !o && setPreset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the layout?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything on the page is replaced with the preset. You can undo this until you leave the editor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (preset) useEditorStore.getState().loadPreset(preset);
                setPreset(null);
              }}
            >
              Replace layout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

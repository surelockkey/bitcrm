import {
  CalendarCheck,
  FileSignature,
  Image as ImageIcon,
  ImagePlus,
  ListOrdered,
  Minus,
  MoveVertical,
  NotebookPen,
  Scissors,
  Sigma,
  Table2,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { DocumentBlockType, DocumentTemplateKind } from "@bitcrm/types";

export interface BlockTool {
  type: DocumentBlockType;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Kinds the block makes sense for (all when absent). */
  kinds?: DocumentTemplateKind[];
}

export const BLOCK_TOOLS: BlockTool[] = [
  { type: "text", label: "Text", hint: "Rich text with values", icon: Type },
  { type: "image", label: "Image", hint: "Upload a picture", icon: ImagePlus },
  { type: "logo", label: "Logo", hint: "Your business logo", icon: ImageIcon },
  { type: "divider", label: "Divider", hint: "Horizontal line", icon: Minus },
  { type: "spacer", label: "Spacer", hint: "Empty vertical space", icon: MoveVertical },
  { type: "table", label: "Table", hint: "Custom grid of text", icon: Table2 },
  { type: "field", label: "Field", hint: "Label + one value", icon: CalendarCheck },
  { type: "itemsTable", label: "Items list", hint: "Products and services", icon: ListOrdered, kinds: ["invoice", "estimate"] },
  { type: "totals", label: "Totals", hint: "Subtotal, tax, total", icon: Sigma, kinds: ["invoice", "estimate"] },
  { type: "signature", label: "Signature", hint: "Signature line", icon: FileSignature },
  { type: "notes", label: "Notes", hint: "The document's notes", icon: NotebookPen },
  { type: "pageBreak", label: "Page break", hint: "Start a new page", icon: Scissors },
];

const BY_TYPE = new Map(BLOCK_TOOLS.map((t) => [t.type, t]));

export function blockTool(type: DocumentBlockType): BlockTool {
  return BY_TYPE.get(type) ?? { type, label: type, hint: "", icon: Type };
}

export const toolsForKind = (kind: DocumentTemplateKind): BlockTool[] =>
  BLOCK_TOOLS.filter((t) => !t.kinds || t.kinds.includes(kind));

export const SECTION_LABELS = {
  header: { label: "Header", hint: "Repeats at the top of every page" },
  body: { label: "Body", hint: "The document content" },
  footer: { label: "Footer", hint: "Repeats at the bottom of every page" },
} as const;

/**
 * Custom PDF document templates (Workiz Settings → Documents). A template is a
 * page of rows → columns → blocks. It is rendered to HTML by
 * `@bitcrm/document-renderer` (same code in the web editor preview and in the
 * billing service's Chromium PDF pipeline).
 *
 * Merge tags are written `{{group.field}}` (e.g. `{{client.fullName}}`). In
 * rich text they are stored as `{ type: 'mergeTag', attrs: { path } }` nodes.
 */

export const DOCUMENT_TEMPLATE_KINDS = ['invoice', 'estimate', 'custom'] as const;
export type DocumentTemplateKind = (typeof DOCUMENT_TEMPLATE_KINDS)[number];

export const DOCUMENT_BLOCK_TYPES = [
  'text',
  'image',
  'logo',
  'divider',
  'spacer',
  'table',
  'field',
  'itemsTable',
  'totals',
  'signature',
  'notes',
  'pageBreak',
] as const;
export type DocumentBlockType = (typeof DOCUMENT_BLOCK_TYPES)[number];

export type TextAlign = 'left' | 'center' | 'right';

/** Box styling shared by rows and blocks. Lengths are CSS px. */
export interface BlockStyle {
  align?: TextAlign;
  color?: string;
  background?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
}

/**
 * ProseMirror/TipTap-compatible JSON subset. Supported node types: doc,
 * paragraph, heading(level 1-3), text, hardBreak, bulletList, orderedList,
 * listItem, mergeTag(attrs.path). Marks: bold, italic, underline,
 * textStyle(attrs.color), link(attrs.href).
 */
export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

interface BlockBase<T extends DocumentBlockType> {
  id: string;
  type: T;
  style?: BlockStyle;
}

export interface TextBlock extends BlockBase<'text'> {
  content: RichTextNode;
}
export interface ImageBlock extends BlockBase<'image'> {
  /** Billing asset id. */
  assetId?: string;
  /** Percent of the column width (10–100). */
  widthPercent: number;
  alt?: string;
}
export interface LogoBlock extends BlockBase<'logo'> {
  /** Max height in px. */
  maxHeight: number;
}
export interface DividerBlock extends BlockBase<'divider'> {
  thickness: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
}
export interface SpacerBlock extends BlockBase<'spacer'> {
  height: number;
}
export interface TableBlock extends BlockBase<'table'> {
  /** rows × cols of rich-text cells. */
  rows: RichTextNode[][];
  headerRow: boolean;
  bordered: boolean;
  /** Column widths in percent (length = columns). */
  columnWidths?: number[];
}
export interface FieldBlock extends BlockBase<'field'> {
  /** Merge tag path, e.g. `invoice.dueDate`. */
  path: string;
  label?: string;
  /** Hide the whole block when the value is empty. */
  hideIfEmpty?: boolean;
}
export const ITEMS_TABLE_COLUMNS = ['name', 'description', 'sku', 'quantity', 'unitPrice', 'taxable', 'amount'] as const;
export type ItemsTableColumn = (typeof ITEMS_TABLE_COLUMNS)[number];
export interface ItemsTableBlock extends BlockBase<'itemsTable'> {
  columns: { key: ItemsTableColumn; label: string; visible: boolean }[];
  headerBackground?: string;
  headerColor?: string;
  striped: boolean;
}
export interface TotalsBlock extends BlockBase<'totals'> {
  showSubtotal: boolean;
  showDiscount: boolean;
  showTax: boolean;
  showPaid: boolean;
  showBalance: boolean;
  totalLabel?: string;
}
export interface SignatureBlock extends BlockBase<'signature'> {
  label: string;
  showDate: boolean;
}
export interface NotesBlock extends BlockBase<'notes'> {
  title?: string;
}
export type PageBreakBlock = BlockBase<'pageBreak'>;

export type DocumentBlock =
  | TextBlock
  | ImageBlock
  | LogoBlock
  | DividerBlock
  | SpacerBlock
  | TableBlock
  | FieldBlock
  | ItemsTableBlock
  | TotalsBlock
  | SignatureBlock
  | NotesBlock
  | PageBreakBlock;

export interface DocumentColumn {
  id: string;
  /** Grid span out of 12; a row's spans sum to 12. */
  span: number;
  blocks: DocumentBlock[];
  verticalAlign?: 'top' | 'middle' | 'bottom';
}

export interface DocumentRow {
  id: string;
  columns: DocumentColumn[];
  style?: BlockStyle;
  /** Gap between columns, px. */
  gap?: number;
}

export interface DocumentPageSettings {
  size: 'letter' | 'a4';
  /** mm */
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  fontFamily: 'Inter' | 'Helvetica' | 'Georgia' | 'Roboto' | 'Times New Roman' | 'Courier New';
  baseFontSize: number;
  textColor: string;
  accentColor: string;
  background?: string;
}

/** "What can my clients see?" (Workiz). */
export interface DocumentVisibility {
  quantity: boolean;
  unitPrice: boolean;
  lineAmount: boolean;
  description: boolean;
  sku: boolean;
  taxableMark: boolean;
  discount: boolean;
  tax: boolean;
  payments: boolean;
  balance: boolean;
}

export const DEFAULT_DOCUMENT_VISIBILITY: DocumentVisibility = {
  quantity: true,
  unitPrice: true,
  lineAmount: true,
  description: true,
  sku: false,
  taxableMark: false,
  discount: true,
  tax: true,
  payments: true,
  balance: true,
};

export interface DocumentTemplateContent {
  page: DocumentPageSettings;
  /** Repeated at the top of every PDF page. */
  header: DocumentRow[];
  body: DocumentRow[];
  /** Repeated at the bottom of every PDF page. */
  footer: DocumentRow[];
  visibility: DocumentVisibility;
}

export interface DocumentTemplate extends DocumentTemplateContent {
  id: string;
  name: string;
  kind: DocumentTemplateKind;
  /** One default per kind (invoice/estimate). */
  isDefault: boolean;
  /** Preset the template was started from (informational). */
  preset?: string;
  /**
   * Workiz "dynamic templates": auto-apply to job documents whose job type /
   * service area matches (any-of). Empty/absent ⇒ never auto-applied.
   */
  autoApply?: { jobTypeIds?: string[]; serviceAreaIds?: string[]; businessProfileIds?: string[] };
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
}

export type DocumentTemplateSummary = Pick<
  DocumentTemplate,
  'id' | 'name' | 'kind' | 'isDefault' | 'preset' | 'autoApply' | 'version' | 'updatedAt'
>;

/**
 * The data a template is rendered against. Built by the billing service
 * (`buildDocumentContext`) or from sample data in the editor.
 */
export interface DocumentRenderContext {
  kind: DocumentTemplateKind;
  business: {
    name: string;
    legalName?: string;
    phone?: string;
    email?: string;
    website?: string;
    licenseNumber?: string;
    address?: string;
    /** data: URI or URL */
    logoUrl?: string;
  };
  client: {
    firstName: string;
    lastName: string;
    fullName: string;
    companyName?: string;
    email?: string;
    phone?: string;
    address?: string;
    billingAddress?: string;
  };
  job?: {
    number: string;
    address?: string;
    jobType?: string;
    serviceArea?: string;
    scheduledDate?: string;
    technicians?: string;
    poNumber?: string;
    customFields?: Record<string, string>;
  };
  document: {
    number: string;
    /** Formatted date */
    date: string;
    dueDate?: string;
    paymentTerms?: string;
    status?: string;
    name?: string;
    notes?: string;
  };
  items: {
    name: string;
    description?: string;
    sku?: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    taxable: boolean;
  }[];
  totals: {
    subtotal: number;
    discount: number;
    taxRateName?: string;
    taxRatePercent: number;
    tax: number;
    total: number;
    amountPaid: number;
    balanceDue: number;
  };
  signature?: { imageUrl?: string; signedBy?: string; signedAt?: string };
  /** Asset id → data: URI / URL for image blocks. */
  assets: Record<string, string>;
  currency: string;
  /** Formatted "today" */
  today: string;
}

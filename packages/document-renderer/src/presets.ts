import type {
  BlockStyle,
  DocumentBlock,
  DocumentColumn,
  DocumentPageSettings,
  DocumentRow,
  DocumentTemplateContent,
  DocumentTemplateKind,
  FieldBlock,
  RichTextNode,
  TextBlock,
} from '@bitcrm/types';
import { DEFAULT_DOCUMENT_VISIBILITY } from '@bitcrm/types';
import { DEFAULT_PAGE_SETTINGS } from './defaults';
import { createBlock } from './factory';
import { newId } from './ids';

export type DocumentPresetId = 'classic' | 'modern' | 'minimal';

export const DOCUMENT_PRESETS: { id: DocumentPresetId; name: string; description: string }[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Logo and business details up top, a bold title with document details, bill-to and service address, itemized table and totals.',
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'A colored header band, bold typography and a shaded client panel.',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean black-and-white layout with generous whitespace.',
  },
];

// ---------------------------------------------------------------------------
// Tiny builders
// ---------------------------------------------------------------------------

type Mark = NonNullable<RichTextNode['marks']>[number];

const tx = (text: string, marks?: Mark[]): RichTextNode => (marks?.length ? { type: 'text', text, marks } : { type: 'text', text });
const bold = (text: string): RichTextNode => tx(text, [{ type: 'bold' }]);
const tag = (path: string): RichTextNode => ({ type: 'mergeTag', attrs: { path } });
const para = (...content: RichTextNode[]): RichTextNode => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
const heading = (level: 1 | 2 | 3, ...content: RichTextNode[]): RichTextNode => ({ type: 'heading', attrs: { level }, content });

function text(content: RichTextNode[], style?: BlockStyle): TextBlock {
  const b: TextBlock = { ...createBlock('text'), content: { type: 'doc', content } };
  if (style) b.style = style;
  return b;
}

function field(path: string, label: string, hideIfEmpty = true, style?: BlockStyle): FieldBlock {
  const b: FieldBlock = { ...createBlock('field'), path, label, hideIfEmpty };
  if (style) b.style = style;
  return b;
}

function withStyle<T extends DocumentBlock>(block: T, style: BlockStyle): T {
  return { ...block, style };
}

function row(
  cols: { span: number; blocks: DocumentBlock[]; verticalAlign?: DocumentColumn['verticalAlign'] }[],
  opts: { style?: BlockStyle; gap?: number } = {},
): DocumentRow {
  const r: DocumentRow = {
    id: newId(),
    columns: cols.map((c) => {
      const col: DocumentColumn = { id: newId(), span: c.span, blocks: c.blocks };
      if (c.verticalAlign) col.verticalAlign = c.verticalAlign;
      return col;
    }),
  };
  if (opts.style) r.style = opts.style;
  if (opts.gap !== undefined) r.gap = opts.gap;
  return r;
}

const full = (...blocks: DocumentBlock[]) => row([{ span: 12, blocks }]);
const spacer = (height: number) => full({ ...createBlock('spacer'), height });

// ---------------------------------------------------------------------------
// Shared content pieces
// ---------------------------------------------------------------------------

interface KindCopy {
  title: string;
  numberLabel: string;
  isInvoice: boolean;
  isEstimate: boolean;
}

function copyFor(kind: DocumentTemplateKind): KindCopy {
  if (kind === 'estimate') return { title: 'Estimate', numberLabel: 'Estimate #', isInvoice: false, isEstimate: true };
  if (kind === 'invoice') return { title: 'Invoice', numberLabel: 'Invoice #', isInvoice: true, isEstimate: false };
  return { title: 'Document', numberLabel: 'Number', isInvoice: false, isEstimate: false };
}

function businessLines(): RichTextNode[] {
  return [
    para(tag('business.address')),
    para(tag('business.phone')),
    para(tag('business.email')),
    para(tag('business.website')),
    para(tag('business.licenseNumber')),
  ];
}

function detailFields(k: KindCopy): FieldBlock[] {
  const fields = [field('document.number', k.numberLabel, false), field('document.date', 'Date', false)];
  if (k.isInvoice) {
    fields.push(field('document.dueDate', 'Due date'), field('document.paymentTerms', 'Terms'));
  }
  if (k.isEstimate) fields.push(field('document.status', 'Status'));
  fields.push(field('job.number', 'Job #'), field('job.poNumber', 'PO #'));
  return fields;
}

function billTo(titleMarks: Mark[]): RichTextNode[] {
  return [
    para(tx('BILL TO', titleMarks)),
    para({ ...tag('client.fullName'), marks: [{ type: 'bold' }] }),
    para(tag('client.companyName')),
    para(tag('client.billingAddress')),
    para(tag('client.phone')),
    para(tag('client.email')),
  ];
}

function serviceAddress(titleMarks: Mark[]): RichTextNode[] {
  return [
    para(tx('SERVICE ADDRESS', titleMarks)),
    para(tag('job.address')),
    para(tx('Job type: '), tag('job.jobType')),
    para(tx('Technician: '), tag('job.technicians')),
    para(tx('Scheduled: '), tag('job.scheduledDate')),
  ];
}

function termsText(k: KindCopy, titleMarks: Mark[]): RichTextNode[] {
  if (k.isInvoice) {
    return [
      para(tx('Terms & conditions', titleMarks)),
      para(
        tx('Payment is due by {{document.dueDate}}. Please reference invoice #{{document.number}} with your payment. '),
        tx('All hardware carries a 1-year limited warranty; labor is warranted for 90 days.'),
      ),
    ];
  }
  if (k.isEstimate) {
    return [
      para(tx('Terms & conditions', titleMarks)),
      para(
        tx('This estimate is valid for 30 days from {{document.date}}. Prices include labor and the listed hardware; '),
        tx('additional work will be quoted before it is performed. Sign below to approve.'),
      ),
    ];
  }
  return [];
}

function signatureBlock(k: KindCopy) {
  return {
    ...createBlock('signature'),
    label: k.isEstimate ? 'Client approval' : 'Client signature',
    showDate: true,
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface PresetDef {
  page: DocumentPageSettings;
  build: (k: KindCopy) => Pick<DocumentTemplateContent, 'header' | 'body' | 'footer'>;
}

const CLASSIC_ACCENT = '#1e3a8a';
const MODERN_ACCENT = '#4f46e5';
const MINIMAL_ACCENT = '#111827';
const MUTED = '#6b7280';

const PRESETS: Record<DocumentPresetId, PresetDef> = {
  classic: {
    page: { ...DEFAULT_PAGE_SETTINGS, fontFamily: 'Helvetica', baseFontSize: 10, textColor: '#1f2937', accentColor: CLASSIC_ACCENT },
    build: (k) => {
      const label: Mark[] = [{ type: 'bold' }, { type: 'textStyle', attrs: { color: CLASSIC_ACCENT } }];
      return {
        header: [
          row([
            { span: 6, blocks: [{ ...createBlock('logo'), maxHeight: 70 }], verticalAlign: 'middle' },
            {
              span: 6,
              blocks: [
                text([heading(3, tag('business.name')), ...businessLines()], { align: 'right', fontSize: 9 }),
              ],
            },
          ]),
          full({ ...createBlock('divider'), thickness: 2, style: { color: CLASSIC_ACCENT } }),
        ],
        body: [
          row([
            {
              span: 7,
              blocks: [
                text(
                  [
                    heading(1, tx(k.title.toUpperCase())),
                    ...(k.isEstimate ? [para(tag('document.name'))] : []),
                  ],
                  { color: CLASSIC_ACCENT },
                ),
              ],
            },
            { span: 5, blocks: detailFields(k) },
          ]),
          spacer(12),
          row(
            [
              { span: 6, blocks: [text(billTo(label))] },
              { span: 6, blocks: [text(serviceAddress(label))] },
            ],
            { gap: 24 },
          ),
          spacer(16),
          full(createBlock('itemsTable')),
          row(
            [
              { span: 6, blocks: [createBlock('notes')] },
              { span: 6, blocks: [{ ...createBlock('totals'), totalLabel: k.isEstimate ? 'Estimate total' : 'Total' }] },
            ],
            { gap: 24, style: { paddingTop: 12 } },
          ),
          spacer(16),
          full(text(termsText(k, label), { fontSize: 9 })),
          spacer(16),
          row([
            { span: 6, blocks: [signatureBlock(k)] },
            { span: 6, blocks: [] },
          ]),
        ],
        footer: [
          full(
            { ...createBlock('divider'), thickness: 1 },
            text(
              [
                para(bold('Thank you for your business!')),
                para(tx(`{{business.name}} · {{business.phone}} · {{business.website}}`)),
                para(tx(`${k.title} #{{document.number}} · {{document.date}}`)),
              ],
              { align: 'center', fontSize: 8, color: MUTED },
            ),
          ),
        ],
      };
    },
  },

  modern: {
    page: { ...DEFAULT_PAGE_SETTINGS, fontFamily: 'Inter', baseFontSize: 10, textColor: '#111827', accentColor: MODERN_ACCENT },
    build: (k) => {
      const label: Mark[] = [{ type: 'bold' }, { type: 'textStyle', attrs: { color: MODERN_ACCENT } }];
      return {
        header: [
          row(
            [
              {
                span: 8,
                verticalAlign: 'middle',
                blocks: [
                  text(
                    [
                      heading(2, tag('business.name')),
                      para(tx('{{business.phone}} · {{business.email}} · {{business.website}}')),
                    ],
                    { color: '#ffffff' },
                  ),
                ],
              },
              {
                span: 4,
                verticalAlign: 'middle',
                blocks: [withStyle({ ...createBlock('logo'), maxHeight: 56 }, { align: 'right' })],
              },
            ],
            {
              style: { background: MODERN_ACCENT, color: '#ffffff', paddingTop: 16, paddingRight: 18, paddingBottom: 16, paddingLeft: 18, borderRadius: 8 },
            },
          ),
        ],
        body: [
          spacer(8),
          row(
            [
              {
                span: 6,
                verticalAlign: 'bottom',
                blocks: [
                  text(
                    [
                      heading(1, tx(k.title)),
                      para(tx(`#{{document.number}}`, [{ type: 'bold' }, { type: 'textStyle', attrs: { color: MODERN_ACCENT } }])),
                      ...(k.isEstimate ? [para(tag('document.name'))] : []),
                    ],
                    { fontWeight: 'bold' },
                  ),
                ],
              },
              { span: 6, verticalAlign: 'bottom', blocks: detailFields(k) },
            ],
            { gap: 32 },
          ),
          spacer(12),
          row(
            [
              { span: 6, blocks: [text(billTo(label))] },
              { span: 6, blocks: [text(serviceAddress(label))] },
            ],
            {
              gap: 24,
              style: { background: '#f3f4f6', paddingTop: 12, paddingRight: 14, paddingBottom: 12, paddingLeft: 14, borderRadius: 8 },
            },
          ),
          spacer(16),
          full({ ...createBlock('itemsTable'), headerBackground: '#111827', headerColor: '#ffffff', striped: true }),
          row(
            [
              { span: 7, blocks: [createBlock('notes')] },
              {
                span: 5,
                blocks: [
                  withStyle(
                    { ...createBlock('totals'), totalLabel: k.isEstimate ? 'Estimate total' : 'Total' },
                    { fontSize: 11 },
                  ),
                ],
              },
            ],
            { gap: 24, style: { paddingTop: 12 } },
          ),
          spacer(20),
          row(
            [
              { span: 7, blocks: k.isInvoice || k.isEstimate ? [text(termsText(k, label), { fontSize: 9, color: '#374151' })] : [] },
              { span: 5, blocks: [signatureBlock(k)] },
            ],
            { gap: 24 },
          ),
        ],
        footer: [
          full(
            text([para(tx('Thank you for choosing {{business.name}} · {{business.phone}} · {{business.email}}'))], {
              align: 'center',
              fontSize: 8,
              color: '#ffffff',
              background: MODERN_ACCENT,
              paddingTop: 6,
              paddingBottom: 6,
              borderRadius: 6,
            }),
          ),
        ],
      };
    },
  },

  minimal: {
    page: {
      ...DEFAULT_PAGE_SETTINGS,
      marginTop: 20,
      marginRight: 20,
      marginBottom: 20,
      marginLeft: 20,
      fontFamily: 'Helvetica',
      baseFontSize: 10,
      textColor: '#111827',
      accentColor: MINIMAL_ACCENT,
    },
    build: (k) => {
      const label: Mark[] = [{ type: 'textStyle', attrs: { color: MUTED } }];
      const titleLines: RichTextNode[] = [
        heading(2, tx(k.title)),
        para(tx('No. {{document.number}}')),
        para(tag('document.date')),
      ];
      if (k.isInvoice) titleLines.push(para(tx('Due {{document.dueDate}}')));
      if (k.isEstimate) titleLines.push(para(tag('document.name')));
      return {
        header: [],
        body: [
          row([
            {
              span: 6,
              blocks: [
                { ...createBlock('logo'), maxHeight: 48 },
                text([para(bold('{{business.name}}')), ...businessLines()], { fontSize: 9, color: MUTED }),
              ],
            },
            { span: 6, blocks: [text(titleLines, { align: 'right' })] },
          ]),
          spacer(32),
          row(
            [
              {
                span: 6,
                blocks: [
                  text([
                    para(tx('Billed to', label)),
                    para(bold('{{client.fullName}}')),
                    para(tag('client.companyName')),
                    para(tag('client.billingAddress')),
                    para(tag('client.email')),
                  ]),
                ],
              },
              {
                span: 6,
                blocks: [
                  text([
                    para(tx('Service address', label)),
                    para(tag('job.address')),
                    para(tx('Job #{{job.number}}')),
                  ]),
                  ...(k.isInvoice ? [field('document.paymentTerms', 'Terms')] : []),
                  field('job.poNumber', 'PO #'),
                ],
              },
            ],
            { gap: 32 },
          ),
          spacer(32),
          full({ ...createBlock('itemsTable'), headerBackground: 'transparent', headerColor: MUTED, striped: false }),
          row([
            { span: 6, blocks: [] },
            { span: 6, blocks: [{ ...createBlock('totals'), totalLabel: 'Total' }] },
          ]),
          spacer(28),
          row(
            [
              { span: 6, blocks: [createBlock('notes')] },
              { span: 6, blocks: [signatureBlock(k)] },
            ],
            { gap: 32 },
          ),
        ],
        footer: [
          full(
            text([para(tx('{{business.name}} · {{business.website}} · Thank you'))], {
              align: 'center',
              fontSize: 8,
              color: MUTED,
            }),
          ),
        ],
      };
    },
  },
};

function customLetter(): Pick<DocumentTemplateContent, 'header' | 'body' | 'footer'> {
  return {
    header: [
      row([
        { span: 6, blocks: [{ ...createBlock('logo'), maxHeight: 64 }], verticalAlign: 'middle' },
        { span: 6, blocks: [text([heading(3, tag('business.name')), ...businessLines()], { align: 'right', fontSize: 9 })] },
      ]),
      full({ ...createBlock('divider'), thickness: 1 }),
    ],
    body: [
      spacer(16),
      full(
        text([
          para(tag('today')),
          para(),
          para(tag('client.fullName')),
          para(tag('client.companyName')),
          para(tag('client.address')),
        ]),
      ),
      spacer(16),
      full(text([heading(2, tx('Document title'))])),
      full(
        text([
          para(tx('Dear {{client.firstName}},')),
          para(
            tx('Write your document here. Merge tags such as {{client.fullName}} or {{job.address}} are filled in automatically '),
            tx('when the document is generated for a job.'),
          ),
          para(),
          para(tx('Sincerely,')),
          para(tag('business.name')),
        ]),
      ),
      spacer(24),
      row([
        { span: 6, blocks: [{ ...createBlock('signature'), label: 'Signature', showDate: true }] },
        { span: 6, blocks: [] },
      ]),
    ],
    footer: [
      full(
        text([para(tx('{{business.name}} · {{business.address}} · {{business.phone}}'))], {
          align: 'center',
          fontSize: 8,
          color: MUTED,
        }),
      ),
    ],
  };
}

function isPresetId(id: unknown): id is DocumentPresetId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, id);
}

/**
 * Starting content for a new template. `invoice`/`estimate` use the preset
 * layout (default `classic`); `custom` is a letter layout styled by the preset.
 * Every call produces fresh ids.
 */
export function createTemplateContent(kind: DocumentTemplateKind, presetId?: string): DocumentTemplateContent {
  const preset = PRESETS[isPresetId(presetId) ? presetId : 'classic'];
  const sections = kind === 'invoice' || kind === 'estimate' ? preset.build(copyFor(kind)) : customLetter();
  return {
    page: { ...preset.page },
    ...sections,
    visibility: { ...DEFAULT_DOCUMENT_VISIBILITY },
  };
}

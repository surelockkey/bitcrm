import type { DocumentBlock, DocumentBlockType, DocumentRow, RichTextNode } from '@bitcrm/types';
import { LIMITS } from './defaults';
import { newId } from './ids';

type BlockOf<T extends DocumentBlockType> = Extract<DocumentBlock, { type: T }>;

function paragraph(text: string): RichTextNode {
  return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };
}

function emptyCell(): RichTextNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** Builds a block of `type` with sensible defaults and a fresh id. */
export function createBlock<T extends DocumentBlockType>(type: T): BlockOf<T> {
  const id = newId();
  let block: DocumentBlock;
  switch (type as DocumentBlockType) {
    case 'text':
      block = { id, type: 'text', content: { type: 'doc', content: [paragraph('Text')] } };
      break;
    case 'image':
      block = { id, type: 'image', widthPercent: 100 };
      break;
    case 'logo':
      block = { id, type: 'logo', maxHeight: 80 };
      break;
    case 'divider':
      block = { id, type: 'divider', thickness: 1, lineStyle: 'solid' };
      break;
    case 'spacer':
      block = { id, type: 'spacer', height: 16 };
      break;
    case 'table':
      block = {
        id,
        type: 'table',
        rows: [
          [emptyCell(), emptyCell()],
          [emptyCell(), emptyCell()],
        ],
        headerRow: true,
        bordered: true,
      };
      break;
    case 'field':
      block = { id, type: 'field', path: 'document.number', label: 'Number', hideIfEmpty: false };
      break;
    case 'itemsTable':
      block = {
        id,
        type: 'itemsTable',
        columns: [
          { key: 'name', label: 'Item', visible: true },
          { key: 'description', label: 'Description', visible: true },
          { key: 'sku', label: 'SKU', visible: true },
          { key: 'quantity', label: 'Qty', visible: true },
          { key: 'unitPrice', label: 'Price', visible: true },
          { key: 'taxable', label: 'Tax', visible: true },
          { key: 'amount', label: 'Amount', visible: true },
        ],
        striped: true,
      };
      break;
    case 'totals':
      block = {
        id,
        type: 'totals',
        showSubtotal: true,
        showDiscount: true,
        showTax: true,
        showPaid: true,
        showBalance: true,
        totalLabel: 'Total',
      };
      break;
    case 'signature':
      block = { id, type: 'signature', label: 'Client signature', showDate: true };
      break;
    case 'notes':
      block = { id, type: 'notes', title: 'Notes' };
      break;
    case 'pageBreak':
      block = { id, type: 'pageBreak' };
      break;
    default:
      throw new RangeError(`Unknown block type: ${String(type)}`);
  }
  return block as BlockOf<T>;
}

/** Builds a row whose columns have the given spans (must sum to 12, 1–4 columns). */
export function createRow(spans: number[]): DocumentRow {
  if (!Array.isArray(spans) || spans.length === 0 || spans.length > LIMITS.maxColumnsPerRow) {
    throw new RangeError(`A row needs 1–${LIMITS.maxColumnsPerRow} columns`);
  }
  if (spans.some((s) => !Number.isInteger(s) || s < 1 || s > 12)) {
    throw new RangeError('Column spans must be integers between 1 and 12');
  }
  if (spans.reduce((a, b) => a + b, 0) !== 12) throw new RangeError('Column spans must sum to 12');
  return { id: newId(), columns: spans.map((span) => ({ id: newId(), span, blocks: [] })) };
}

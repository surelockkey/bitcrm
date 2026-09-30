import type { DocumentPageSettings } from '@bitcrm/types';

/** Structural limits enforced by `validateTemplateContent` (and defensively by the renderer). */
export const LIMITS = {
  maxRowsPerSection: 100,
  maxColumnsPerRow: 4,
  maxBlocksPerColumn: 50,
  /** Max nesting depth of a rich-text JSON tree (doc = depth 1). */
  maxRichTextDepth: 16,
  /** Max nodes in one rich-text tree. */
  maxRichTextNodes: 5000,
  /** Max characters in one text node. */
  maxTextLength: 20000,
  maxTableRows: 50,
  maxTableColumns: 10,
  maxLabelLength: 200,
  maxMarginMm: 60,
  maxSpacerHeight: 400,
  minFontSize: 6,
  maxFontSize: 96,
  minBaseFontSize: 6,
  maxBaseFontSize: 24,
  maxPadding: 200,
  maxBorderWidth: 20,
  maxBorderRadius: 100,
  maxRowGap: 96,
  maxDividerThickness: 20,
  minLogoHeight: 16,
  maxLogoHeight: 400,
} as const;

export const DEFAULT_TEXT_COLOR = '#111827';
export const DEFAULT_ACCENT_COLOR = '#2563eb';
export const DEFAULT_ROW_GAP = 16;

export const DEFAULT_PAGE_SETTINGS: DocumentPageSettings = {
  size: 'letter',
  marginTop: 15,
  marginRight: 15,
  marginBottom: 15,
  marginLeft: 15,
  fontFamily: 'Inter',
  baseFontSize: 10,
  textColor: DEFAULT_TEXT_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
};

export const PAGE_SIZES: Record<DocumentPageSettings['size'], { width: string; height: string; css: string }> = {
  letter: { width: '8.5in', height: '11in', css: 'letter' },
  a4: { width: '210mm', height: '297mm', css: 'A4' },
};

export const FONT_STACKS: Record<DocumentPageSettings['fontFamily'], string> = {
  Inter: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
  Roboto: '"Roboto", "Helvetica Neue", Helvetica, Arial, sans-serif',
  Helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  Georgia: 'Georgia, "Times New Roman", Times, serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  'Courier New': '"Courier New", Courier, monospace',
};

/** Google Fonts stylesheet per family — screen mode only. */
export const WEB_FONT_URLS: Partial<Record<DocumentPageSettings['fontFamily'], string>> = {
  Inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  Roboto: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap',
};

export const FONT_FAMILIES = Object.keys(FONT_STACKS) as DocumentPageSettings['fontFamily'][];

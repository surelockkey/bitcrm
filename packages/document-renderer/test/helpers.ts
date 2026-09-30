import type { DocumentBlock, DocumentTemplateContent, RichTextNode } from '@bitcrm/types';
import { DEFAULT_DOCUMENT_VISIBILITY } from '@bitcrm/types';
import { createRow } from '../src';

export function doc(...content: RichTextNode[]): RichTextNode {
  return { type: 'doc', content };
}
export function p(...content: RichTextNode[]): RichTextNode {
  return { type: 'paragraph', content };
}
export function t(text: string, marks?: RichTextNode['marks']): RichTextNode {
  return marks ? { type: 'text', text, marks } : { type: 'text', text };
}
export function tag(path: string): RichTextNode {
  return { type: 'mergeTag', attrs: { path } };
}

export function emptyTemplate(): DocumentTemplateContent {
  return {
    page: {
      size: 'letter',
      marginTop: 15,
      marginRight: 15,
      marginBottom: 15,
      marginLeft: 15,
      fontFamily: 'Inter',
      baseFontSize: 11,
      textColor: '#111827',
      accentColor: '#2563eb',
    },
    header: [],
    body: [],
    footer: [],
    visibility: { ...DEFAULT_DOCUMENT_VISIBILITY },
  };
}

/** Template with a single full-width row containing the given blocks. */
export function templateWith(...blocks: DocumentBlock[]): DocumentTemplateContent {
  const tpl = emptyTemplate();
  const row = createRow([12]);
  row.columns[0].blocks = blocks;
  tpl.body = [row];
  return tpl;
}

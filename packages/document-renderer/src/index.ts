/**
 * @bitcrm/document-renderer — renders BitCRM document templates
 * (rows → columns → blocks) to self-contained HTML. Pure TypeScript: used by
 * the web editor preview (iframe srcdoc) and by the billing service's
 * headless-Chromium PDF pipeline.
 */
export { renderDocumentHtml } from './render';
export { renderBlockHtml } from './blocks';
export type { RenderMode, RenderOptions } from './blocks';
export { MERGE_TAGS, MERGE_TAG_GROUPS, resolveMergeTag, interpolate } from './merge-tags';
export type { MergeTagDef, MergeTagGroupId } from './merge-tags';
export { DOCUMENT_PRESETS, createTemplateContent } from './presets';
export type { DocumentPresetId } from './presets';
export { createBlock, createRow } from './factory';
export { newId } from './ids';
export { sampleRenderContext } from './sample';
export { validateTemplateContent } from './validate';
export type { ValidationResult } from './validate';
export { formatMoney, formatPercent } from './money';
export { escapeHtml, safeColor, safeUrl } from './escape';
export { LIMITS, DEFAULT_PAGE_SETTINGS, FONT_STACKS, PAGE_SIZES } from './defaults';
export { RICH_TEXT_NODE_TYPES, RICH_TEXT_MARK_TYPES } from './rich-text';

/**
 * The one place billing touches `@bitcrm/document-renderer` (contract §2), so
 * unit tests can mock `src/documents/renderer` instead of the package.
 */
export {
  renderDocumentHtml,
  createTemplateContent,
  validateTemplateContent,
  DOCUMENT_PRESETS,
  sampleRenderContext,
} from '@bitcrm/document-renderer';

import { createHash } from 'node:crypto';
import type { DocumentRenderContext, DocumentTemplate } from '@bitcrm/types';

/**
 * Content address of a rendered PDF: the template (id + version) and the
 * exact context it was rendered with. Same inputs → same S3 object, so a
 * repeat download never launches Chromium.
 */
export function pdfCacheHash(
  template: Pick<DocumentTemplate, 'id' | 'version'>,
  ctx: DocumentRenderContext,
): string {
  return createHash('sha256')
    .update(`${template.id}:${template.version}:${JSON.stringify(ctx)}`)
    .digest('hex');
}

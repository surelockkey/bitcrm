import { Injectable, NotFoundException } from '@nestjs/common';
import { TemplateRenderer } from '../templates/template-renderer';
import { type MessageTemplateRenderer, type RenderTemplateInput, type RenderedTemplate } from './template-renderer';

/**
 * Bridges the send path (`MESSAGE_TEMPLATE_RENDERER`, design §4.4) to the
 * templates module's `TemplateRenderer` (M11): the conversation party
 * becomes the CRM contact ref, the job the deal ref, and the composer's
 * text — when present — is what gets rendered (an edited draft wins over
 * the stored template body, as `TemplateRenderer.render` documents).
 * An unknown or archived template yields `null` so the caller keeps the
 * composer's text instead of failing the send.
 */
@Injectable()
export class TemplateRendererAdapter implements MessageTemplateRenderer {
  constructor(private readonly renderer: TemplateRenderer) {}

  async render(input: RenderTemplateInput): Promise<RenderedTemplate | null> {
    try {
      const result = await this.renderer.render(
        {
          templateId: input.templateId,
          body: input.body?.trim() ? input.body : undefined,
          format: input.channel === 'email' ? 'html' : 'text',
        },
        {
          conversationId: input.conversationId,
          contactId: input.partyKind === 'contact' ? input.partyId : undefined,
          dealId: input.dealId,
        },
      );
      return { body: result.body, subject: result.subject };
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }
}

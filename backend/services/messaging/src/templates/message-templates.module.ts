import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagingSettingsModule } from '../settings/messaging-settings.module';
import { MessageTemplatesRepository } from './message-templates.repository';
import { MessageTemplatesService } from './message-templates.service';
import { MessageTemplatesController } from './message-templates.controller';
import { TemplateRenderer } from './template-renderer';
import { ContextLoader } from './context-loader';

/**
 * Templates + the short-code renderer (M11). Exports `TemplateRenderer` for
 * the outbound path:
 *
 *   render({ templateId?, body? }, { conversationId?, contactId?, dealId?, userId? })
 *     → Promise<{ body: string; missing: string[] }>
 *
 * (full signature in `template-renderer.ts`).
 */
@Module({
  imports: [ConversationsModule, MessagingSettingsModule],
  controllers: [MessageTemplatesController],
  providers: [MessageTemplatesRepository, MessageTemplatesService, ContextLoader, TemplateRenderer],
  exports: [MessageTemplatesRepository, MessageTemplatesService, TemplateRenderer, ContextLoader],
})
export class MessageTemplatesModule {}

/** The name the design (§10, M11) and the outbound path use for this module. */
export { MessageTemplatesModule as TemplatesModule };
export { TemplateRenderer } from './template-renderer';
export type { RenderInput, RenderResult, RenderFormat } from './template-renderer';
export type { RenderContext, RenderRefs } from './render-context';

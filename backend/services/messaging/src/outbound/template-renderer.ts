import { type ConversationPartyKind, type SendableMessageChannel } from '@bitcrm/types';

/**
 * What the send path asks of the templates module (M11) when a message
 * names a `templateId`: the short codes (`{{first_name}}`, custom fields…)
 * substituted for this party and job.
 *
 * TODO(M11): the templates module provides an implementation under
 * `MESSAGE_TEMPLATE_RENDERER` (`{ provide: MESSAGE_TEMPLATE_RENDERER,
 * useExisting: MessageTemplatesService }`) and `OutboundModule` imports it.
 * Until then `SendService` injects it `@Optional()`: the composer already
 * renders through `POST /templates/:id/render` (design §7.1) and sends the
 * finished text in `body`, so a missing renderer only means the template is
 * recorded on the message, not re-rendered server-side.
 */
export const MESSAGE_TEMPLATE_RENDERER = Symbol('MESSAGE_TEMPLATE_RENDERER');

export interface RenderTemplateInput {
  templateId: string;
  channel: SendableMessageChannel;
  conversationId: string;
  partyKind: ConversationPartyKind;
  partyId?: string;
  dealId?: string;
  /** The text the composer sent, for renderers that only fill placeholders. */
  body?: string;
}

export interface RenderedTemplate {
  body: string;
  subject?: string;
}

export interface MessageTemplateRenderer {
  /** `null` when the template is unknown or archived — the caller keeps the composer's text. */
  render(input: RenderTemplateInput): Promise<RenderedTemplate | null>;
}

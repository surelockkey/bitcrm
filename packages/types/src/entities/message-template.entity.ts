/** Which composer channel a template is offered for. */
export const MESSAGE_TEMPLATE_CHANNELS = ['sms', 'email', 'any'] as const;
export type MessageTemplateChannel = (typeof MESSAGE_TEMPLATE_CHANNELS)[number];

/**
 * A canned message with `{{short_code}}` placeholders. Field names follow the
 * Workiz export so the 39 existing templates import verbatim.
 * Stored as `TEMPLATE#<id>` / `METADATA`, listed via the GSI3 catalog
 * partition `CATALOG#MESSAGE_TEMPLATE` (design §3.2).
 */
export interface MessageTemplate {
  id: string;
  messageTemplateTitle: string;
  /** HTML body, as Workiz stores it. */
  messageTemplate: string;
  /** Draft.js raw content, when the editor produced one. */
  messageJson?: Record<string, unknown>;
  messageSubjectTemplate?: string;
  messageSubjectJson?: Record<string, unknown>;
  messageFrom?: string;
  isDefault: boolean;
  channel: MessageTemplateChannel;
  /** Archived templates stay resolvable for history but leave the picker. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** `workiz:smstemplate:<_id>` for imported templates. */
  externalId?: string;
}

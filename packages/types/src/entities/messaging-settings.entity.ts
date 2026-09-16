/** Local-time window in which automations hold non-urgent messages. */
export interface QuietHours {
  /** `HH:mm` */
  from: string;
  /** `HH:mm` */
  to: string;
  /** IANA zone, e.g. `America/New_York`. */
  timezone: string;
}

/**
 * Workspace-wide messaging configuration — a singleton
 * (`MESSAGING#SETTINGS` / `METADATA`), field names after Workiz
 * `account_sms_settings` so the import is a straight copy (design §3.2).
 */
export interface MessagingSettings {
  /** E.164 fallback sender (Workiz `snd_number`); rung 6 of the sender chain. */
  defaultSenderNumber?: string;
  /** Numbers that forward to the default sender (Workiz `sndFwd`). */
  sndFwd?: string[];
  /** Template of the "New job" SMS sent to technicians (Workiz `sms_format`). */
  smsFormat?: string;
  useCloseLink?: boolean;
  /** Text prepended to every outbound SMS (Workiz `sms_pre`). */
  smsPre?: string;
  onMyWayMsg?: string;
  lateMsg?: string;
  onMyWayMsgNotify?: boolean;
  lateMsgNotify?: boolean;
  quietHours?: QuietHours;
  /** Appended to every outbound SMS after the body (BitCRM; Workiz only had `sms_pre`). */
  signature?: string;
  /**
   * Base URLs for `{{confirm_link}}` / `{{info_link}}`. `{{deal_id}}` /
   * `{{job_id}}` inside the URL are substituted; otherwise `/<dealId>` is appended.
   */
  confirmLinkBaseUrl?: string;
  infoLinkBaseUrl?: string;
  /**
   * Auto-reply texts (design §4.7). Twilio Advanced Opt-Out answers STOP/HELP
   * itself; these are what BitCRM sends when it has to (number outside the
   * Messaging Service, email). HELP must name the company and a phone (§4.8).
   */
  stopReplyText?: string;
  helpReplyText?: string;
  /** The business as clients see it — `{{biz_name}}`, `{{biz_number}}`, `{{biz_email}}` (Workiz `cnam` for the name). */
  companyName?: string;
  /** E.164; `{{biz_number}}` falls back to `defaultSenderNumber`. */
  companyPhone?: string;
  companyEmail?: string;
  /** Company default IANA zone for date/time short codes; a job's own zone wins when a deal carries one. */
  timezone?: string;
  updatedAt?: string;
  updatedBy?: string;
}

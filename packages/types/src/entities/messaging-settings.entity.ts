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
  updatedAt?: string;
  updatedBy?: string;
}

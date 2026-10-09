/**
 * The account's security settings — Workiz's Settings → Security Center
 * (`/root/securityCenter`, settings_audit_wz_security_v4). One row for the
 * whole workspace, read by the sign-in gate and the Security Center page.
 */
export interface SecuritySettings {
  /**
   * Workiz "Require Two-factor authentication (2FA)": every sign-in needs the
   * second step, whatever the person's own switch says. Someone with no
   * phone on their profile is asked to set one up before they get in. A
   * subcontractor is exempt — they have no sign-in to protect.
   */
  requireMfa: boolean;
  /**
   * Workiz "Login sending options": the sign-in code may also go to the
   * account's email, on request, beside the text.
   */
  loginCodeByEmail: boolean;
  /**
   * Workiz "OTP sending options": an in-app check (e.g. before an export)
   * may send its code by email. Stored for the checks to read; BitCRM has
   * no in-app checks yet.
   */
  otpByEmail: boolean;
  /** When and by whom the row last changed; absent until someone saves it. */
  updatedAt?: string;
  updatedBy?: string;
}

/** What an account has until someone saves the page: nothing required, nothing by email. */
export const DEFAULT_SECURITY_SETTINGS: Readonly<SecuritySettings> = Object.freeze({
  requireMfa: false,
  loginCodeByEmail: false,
  otpByEmail: false,
});

/** `PUT /users/security-settings`: the switches, any subset. */
export type UpdateSecuritySettingsRequest = Partial<Pick<SecuritySettings, 'requireMfa' | 'loginCodeByEmail' | 'otpByEmail'>>;

/**
 * One line of the Security Center's change log (`GET
 * /users/security-settings/audit`): who flipped what, from what, to what.
 */
export interface SecuritySettingsAuditEntry {
  actorId: string;
  timestamp: string;
  before: Pick<SecuritySettings, 'requireMfa' | 'loginCodeByEmail' | 'otpByEmail'>;
  after: Pick<SecuritySettings, 'requireMfa' | 'loginCodeByEmail' | 'otpByEmail'>;
}

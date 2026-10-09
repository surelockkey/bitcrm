// The account's security settings (Workiz Settings → Security Center): one
// row of the users table, absent until someone saves the page.
//   PK = SETTINGS, SK = SECURITY
export const SECURITY_SETTINGS_PK = 'SETTINGS';
export const SECURITY_SETTINGS_SK = 'SECURITY';

// Append-only log of every change to it: PK = AUDIT#SECURITY_SETTINGS,
// SK = <ISO timestamp>#<uuid> — newest last, read backwards.
export const SECURITY_AUDIT_PK = 'AUDIT#SECURITY_SETTINGS';

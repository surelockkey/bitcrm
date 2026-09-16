import { extractShortCodes, PLACEHOLDER } from '../../templates/template-renderer';
import { isKnownShortCode } from '../../templates/short-codes';

/**
 * Short codes the Automation Center used that the message templates never
 * did, and their BitCRM spelling (`templates/short-codes.ts`). Workiz gave
 * the same value two names depending on the editor: a rule body says
 * `{{uuid}}` and `{{location_key}}` where a template says `{{job_id}}` and
 * `{{full_address}}`. Rewriting them when the rule is translated means the
 * text a dispatcher sees in the Automation Center is the text the renderer
 * can actually fill, and the editor's short-code menu offers the same list
 * as everywhere else.
 */
export const WORKIZ_RULE_SHORT_CODES: Readonly<Record<string, string>> = {
  uuid: 'job_id',
  location_key: 'full_address',
  jobAddress: 'full_address',
  job_description: 'description',
  jobDate: 'job_date',
  jobTime: 'appointment_time',
  jobEndTime: 'job_end_time',
  primary_phone: 'phone_number',
  client_phone_number: 'phone_number',
  account_business_name: 'biz_name',
  account_business_phone: 'biz_number',
  account_business_email: 'biz_email',
  tech_name: 'tech_assigned',
};

export interface ShortCodeRewrite {
  text: string;
  /** Codes that were renamed, `from → to`. */
  renamed: string[];
  /** Codes nothing in BitCRM resolves — they stay in the text and render empty. */
  unknown: string[];
}

/** Rewrites the Workiz spellings and reports what is left unresolvable. */
export function rewriteShortCodes(body: string | undefined): ShortCodeRewrite {
  if (!body) return { text: '', renamed: [], unknown: [] };
  const renamed: string[] = [];
  const text = body.replace(PLACEHOLDER, (placeholder, raw: string) => {
    const code = String(raw).trim();
    const mapped = WORKIZ_RULE_SHORT_CODES[code];
    if (!mapped) return placeholder;
    if (!renamed.includes(`${code} → ${mapped}`)) renamed.push(`${code} → ${mapped}`);
    return `{{${mapped}}}`;
  });
  const unknown = extractShortCodes(text).filter((code) => !isKnownShortCode(code));
  return { text, renamed, unknown };
}

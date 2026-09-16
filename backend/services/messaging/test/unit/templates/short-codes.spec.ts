import {
  SHORT_CODES,
  buildLink,
  formatFullAddress,
  formatPhone,
  isKnownShortCode,
  resolveShortCode,
} from '../../../src/templates/short-codes';
import { fullContext } from './render-fixtures';

/** Workiz `short_codes_sms.json` (22) + the client-list extras + the spellings the templates use. */
const WORKIZ_STANDARD_CODES = [
  'job_id', 'full_name', 'first_name', 'last_name', 'company_name', 'phone_number', 'job_type', 'client_email',
  'job_date', 'appointment_time', 'job_end_time', 'full_address', 'address', 'city', 'state', 'zip_code',
  'tech_assigned', 'description', 'confirm_link', 'info_link', 'ad_group', 'referral_company_name',
];
const WORKIZ_CLIENT_EXTRAS = ['biz_name', 'biz_number', 'biz_email'];
const WORKIZ_TEMPLATE_SPELLINGS = ['client_first_name', 'client_last_name', 'client_client_company_name', 'billing_location_key', 'late_value'];

const EXPECTED: Record<string, string> = {
  job_id: 'K4T9ZW',
  full_name: 'Jane Doe',
  first_name: 'Jane',
  last_name: 'Doe',
  company_name: 'Acme Property Mgmt',
  phone_number: '(404) 555-1234',
  job_type: 'Lock change',
  client_email: 'jane@example.com',
  job_date: 'Sep 15, 2026',
  appointment_time: '2:30 PM',
  job_end_time: '4:00 PM',
  full_address: '12 Main St Apt 3, Atlanta, GA 30301',
  address: '12 Main St Apt 3',
  city: 'Atlanta',
  state: 'GA',
  zip_code: '30301',
  tech_assigned: 'Mike Smith',
  description: 'Rekey front and back doors',
  confirm_link: 'https://book.example.com/confirm/d1',
  info_link: 'https://book.example.com/job/d1/info',
  ad_group: 'Google Ads',
  referral_company_name: 'Roadside Partner LLC',
  biz_name: 'Sure Lock & Key',
  biz_number: '(203) 403-6303',
  biz_email: 'office@example.com',
  client_first_name: 'Jane',
  client_last_name: 'Doe',
  client_client_company_name: 'Acme Property Mgmt',
  billing_location_key: '12 Main St Apt 3, Atlanta, GA 30301',
  late_value: '15',
  tech_phone: '(404) 555-9876',
};

describe('short-code registry', () => {
  it('covers every Workiz short code by its exact name', () => {
    for (const code of [...WORKIZ_STANDARD_CODES, ...WORKIZ_CLIENT_EXTRAS, ...WORKIZ_TEMPLATE_SPELLINGS]) {
      expect(isKnownShortCode(code)).toBe(true);
    }
    expect(SHORT_CODES.map((d) => d.code)).toEqual(Object.keys(EXPECTED));
  });

  it('describes every code and points aliases at a real code', () => {
    const codes = new Set(SHORT_CODES.map((d) => d.code));
    for (const d of SHORT_CODES) {
      expect(d.description.length).toBeGreaterThan(5);
      expect(d.example).toBeDefined();
      expect(['client', 'job', 'technician', 'business', 'links']).toContain(d.group);
      if (d.aliasOf) expect(codes.has(d.aliasOf)).toBe(true);
    }
  });

  it.each(Object.entries(EXPECTED))('resolves {{%s}} from a full context', (code, expected) => {
    expect(resolveShortCode(code, fullContext())).toBe(expected);
  });

  it.each(SHORT_CODES.map((d) => d.code))('reports {{%s}} as missing on an empty context', (code) => {
    expect(resolveShortCode(code, {})).toBeUndefined();
  });

  it('is undefined for an unknown code', () => {
    expect(resolveShortCode('nope', fullContext())).toBeUndefined();
  });

  it("prefers the job's client-name override for name codes but keeps the contact's phone", () => {
    const ctx = fullContext();
    ctx.deal!.clientName = { firstName: 'Bob', lastName: 'Tenant' };
    expect(resolveShortCode('full_name', ctx)).toBe('Bob Tenant');
    expect(resolveShortCode('client_first_name', ctx)).toBe('Bob');
    expect(resolveShortCode('phone_number', ctx)).toBe('(404) 555-1234');
  });

  it("falls back to the contact's address when the job has none", () => {
    const ctx = fullContext();
    delete ctx.deal!.address;
    expect(resolveShortCode('full_address', ctx)).toBe('9 Elm St, Decatur, GA 30030');
    expect(resolveShortCode('address', ctx)).toBe('9 Elm St');
    expect(resolveShortCode('city', ctx)).toBe('Decatur');
  });

  it('renders "All day" for all-day jobs', () => {
    const ctx = fullContext();
    ctx.deal!.allDay = true;
    delete ctx.deal!.scheduledTimeSlot;
    expect(resolveShortCode('appointment_time', ctx)).toBe('All day');
    expect(resolveShortCode('job_end_time', ctx)).toBe('All day');
    expect(resolveShortCode('job_date', ctx)).toBe('Sep 15, 2026');
  });

  it('formats dates in the job zone, then the company zone, then the default', () => {
    const ctx = fullContext();
    ctx.deal!.scheduledDate = '2026-09-15T23:30:00.000Z';
    delete ctx.timezone;
    expect(resolveShortCode('job_date', ctx)).toBe('Sep 15, 2026'); // America/New_York default
    ctx.settings!.timezone = 'Europe/Kyiv';
    expect(resolveShortCode('job_date', ctx)).toBe('Sep 16, 2026');
    ctx.deal!.jobTimezone = 'America/Los_Angeles';
    expect(resolveShortCode('job_date', ctx)).toBe('Sep 15, 2026');
  });

  it('uses the default sender for biz_number when no company phone is set', () => {
    const ctx = fullContext();
    delete ctx.settings!.companyPhone;
    expect(resolveShortCode('biz_number', ctx)).toBe('(555) 000-1111');
  });

  it('builds links from settings and needs a deal', () => {
    expect(buildLink('https://x.io/c/', { id: 'd 1' })).toBe('https://x.io/c/d%201');
    expect(buildLink('https://x.io/{job_id}', { id: 'd1', dealNumber: 'AB12' })).toBe('https://x.io/AB12');
    expect(buildLink('https://x.io/c', undefined)).toBeUndefined();
    expect(buildLink(undefined, { id: 'd1' })).toBeUndefined();
    const ctx = fullContext();
    delete ctx.deal;
    expect(resolveShortCode('confirm_link', ctx)).toBeUndefined();
  });

  it('formats US numbers and leaves others alone', () => {
    expect(formatPhone('+14045551234')).toBe('(404) 555-1234');
    expect(formatPhone('+380958601427')).toBe('+380958601427');
    expect(formatPhone(undefined)).toBeUndefined();
  });

  it('skips empty address parts', () => {
    expect(formatFullAddress({ street: '1 A St', city: '', state: 'GA', zip: '' })).toBe('1 A St, GA');
  });
});

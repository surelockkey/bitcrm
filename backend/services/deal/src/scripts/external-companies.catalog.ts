import { randomUUID } from 'node:crypto';
import { type ExternalCompany } from '@bitcrm/types';

/**
 * The external-company list migrated from the previous CRM, verbatim: same
 * names, contact details and Enabled/Disabled state. Blank cells in the export
 * stay blank here (omitted, not empty strings), and the stray `mailto:`
 * prefixes a couple of rows carried are stripped.
 */
export const EXTERNAL_COMPANIES_SEED: {
  name: string;
  email?: string;
  address?: string;
  phone?: string;
  active: boolean;
}[] = [
  { name: 'Agero', active: false },
  { name: 'All United', active: false },
  {
    name: 'Allied Dispatch Solutions',
    email: 'Tammy.Killen@allieddispatch.com',
    address: '500 Borla Dr, Johnson City, TN 37604',
    phone: '(855) 281-0219',
    active: false,
  },
  { name: 'American Services IL', phone: '(630) 626-3992', active: true },
  { name: 'AZ SHI ALI', email: 'shaiprego@gmail.com', phone: '(702) 970-1174', active: false },
  {
    name: 'bioclening LIOER',
    email: 'Mo@surelockkey.com',
    address: '50 fitch st, #206c',
    phone: '(480) 500-7541',
    active: false,
  },
  {
    name: 'BNG',
    email: 'bngref@gmail.com',
    address: 'PO box 10668 Rochester NY',
    phone: '(716) 219-0156',
    active: false,
  },
  { name: 'Burnhams Locksmith', active: false },
  { name: 'Costco David', active: true },
  { name: 'Customer Refural', active: false },
  { name: 'DMDY', active: false },
  { name: 'Ergentl.y', active: false },
  { name: 'Friend Ref', active: false },
  { name: 'Google Add', active: false },
  { name: 'Home Adviser', active: false },
  {
    name: 'IRBID LOCKSMITH',
    email: 'Mh2002.mb13@gmail.com',
    address: 'Houston, TX',
    phone: '(346) 393-1487',
    active: true,
  },
  { name: 'Lior Ali AZ', phone: '(480) 444-9881', active: false },
  {
    name: 'Lucky Locksmith',
    email: '41193@lite.serviceslogin.com',
    address: 'Dorchester Ln Greenwich, CT 06878',
    phone: '(917) 885-2705',
    active: false,
  },
  { name: 'MANDEL AZ', email: 'Mendelbeck@gmail.com', phone: '(480) 788-7612', active: true },
  {
    name: 'Omri Lipmen',
    email: 'info@midtownlocksmithnyc.com',
    phone: '(917) 652-6674',
    active: true,
  },
  {
    name: 'Papas Lock Out Service',
    email: 'Papaslockoutservice@gmail.com',
    address: '897 Bloomfield Ave Windsor, CT 06095',
    phone: '(855) 539-2386',
    active: true,
  },
  { name: 'Pro Referral', active: false },
  { name: 'Protech Office FL', phone: '(213) 616-7717', active: true },
  { name: 'Shmual Chicago', phone: '(773) 818-4394', active: false },
  { name: 'Shraga Marketing', phone: '(929) 370-1450', active: false },
  { name: 'team locksmith', phone: '(619) 736-3332', active: false },
  { name: 'Thumb Tack', active: false },
  { name: 'Web Site (SEO)', active: false },
  { name: 'Wizard Locksmith', active: false },
  {
    name: 'YAKIR NATAN',
    email: 'DALLASAREALOCKSMITH@GMAIL.COM',
    address: 'TX',
    phone: '(214) 430-2144',
    active: true,
  },
  { name: 'YANIV TAXES', active: false },
  { name: 'Yelp', active: false },
  {
    name: 'YIGAL dr locks stamford',
    email: 'Mo@surelockkey.com',
    phone: '(203) 921-5324',
    active: true,
  },
];

/**
 * Which companies still need creating, given the names already in the catalog.
 * Name matching is case-insensitive so a re-run never duplicates a row.
 */
export function planExternalCompanySeed(existingNames: string[]): ExternalCompany[] {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const now = new Date().toISOString();

  return EXTERNAL_COMPANIES_SEED.filter(
    (c) => !taken.has(c.name.trim().toLowerCase()),
  ).map((c) => ({
    id: randomUUID(),
    name: c.name,
    email: c.email,
    address: c.address,
    phone: c.phone,
    active: c.active,
    createdBy: 'external-companies-seed',
    createdAt: now,
    updatedAt: now,
  }));
}

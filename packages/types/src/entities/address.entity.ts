export interface Address {
  street: string;
  unit?: string;
  city: string;
  state: string;
  zip: string;
  /**
   * ISO 3166-1 alpha-2 (`US`, `CA`, `GB`, …), upper case — Workiz's "Country"
   * select. Absent means `DEFAULT_ADDRESS_COUNTRY`: every address written
   * before the field existed is a US one. The Workiz importer writes the same
   * codes.
   */
  country?: string;
  lat?: number;
  lng?: number;
}

/** What an address without a `country` is in: Workiz's default, "United States". */
export const DEFAULT_ADDRESS_COUNTRY = 'US';

/** The shape of `Address.country`: two upper-case letters (ISO 3166-1 alpha-2). */
export const ADDRESS_COUNTRY_PATTERN = /^[A-Z]{2}$/;

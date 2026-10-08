/**
 * Workiz's "Country" select on a job's Service Location (default "United
 * States"). Stored as ISO 3166-1 alpha-2 — the shape the Workiz importer
 * already writes (`US`, `CA`, `GB`, …) — and absent means US.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddressDto } from 'src/deals/dto/address.dto';
import { UpdateDealDto } from 'src/deals/dto/update-deal.dto';

const street = { street: '1 Front St W', city: 'Toronto', state: 'ON', zip: 'M5J 2X5' };

const parse = (payload: object) => plainToInstance(AddressDto, payload);
const errorsOf = async (payload: object) =>
  (await validate(parse(payload), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

describe('AddressDto.country', () => {
  it('is optional — an address without one is a US address', async () => {
    expect(await errorsOf(street)).toEqual([]);
  });

  it('accepts a two-letter ISO code', async () => {
    expect(await errorsOf({ ...street, country: 'CA' })).toEqual([]);
    expect(await errorsOf({ ...street, country: 'US' })).toEqual([]);
  });

  it('stores the code upper-cased and trimmed', async () => {
    expect(parse({ ...street, country: ' ca ' }).country).toBe('CA');
  });

  it('takes a blank one as no country (US) — what an untouched form field sends', async () => {
    expect(await errorsOf({ ...street, country: '  ' })).toEqual([]);
    expect(parse({ ...street, country: '' }).country).toBeUndefined();
  });

  it('refuses a country name or a three-letter code', async () => {
    for (const country of ['Canada', 'United States', 'USA', 'C', 'C1', 42]) {
      expect(await errorsOf({ ...street, country })).toEqual(['country']);
    }
  });

  it('is validated inside a job update too', async () => {
    const errors = await validate(plainToInstance(UpdateDealDto, { address: { ...street, country: 'Canada' } }));
    expect(errors.map((e) => e.property)).toEqual(['address']);
  });
});

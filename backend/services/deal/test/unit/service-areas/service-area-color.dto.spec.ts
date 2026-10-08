/**
 * A service area's chip colour (Workiz paints areas as coloured chips in
 * Filter results). Sent as `#rrggbb`; `null` or `''` clears it — the same
 * "send nothing to keep, null or blank to clear" rule as the caller id.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ServiceAreaType } from '@bitcrm/types';
import { CreateServiceAreaDto } from 'src/service-areas/dto/create-service-area.dto';
import { UpdateServiceAreaDto } from 'src/service-areas/dto/update-service-area.dto';

const area = { name: 'North Carolina', type: ServiceAreaType.ZIPS, zips: [{ zip: '27601' }] };

const errorsOf = async (cls: new () => object, payload: object) =>
  (await validate(plainToInstance(cls, payload), { whitelist: true, forbidNonWhitelisted: true })).map(
    (e) => e.property,
  );

describe.each([
  ['CreateServiceAreaDto', CreateServiceAreaDto, area],
  ['UpdateServiceAreaDto', UpdateServiceAreaDto, {}],
] as const)('%s.color', (_name, cls, base) => {
  it('is optional', async () => {
    expect(await errorsOf(cls, base)).toEqual([]);
  });

  it('accepts a six-digit hex colour, either case', async () => {
    expect(await errorsOf(cls, { ...base, color: '#dc143c' })).toEqual([]);
    expect(await errorsOf(cls, { ...base, color: '#B8860B' })).toEqual([]);
  });

  it('accepts null and a blank string — both clear it', async () => {
    expect(await errorsOf(cls, { ...base, color: null })).toEqual([]);
    expect(await errorsOf(cls, { ...base, color: '' })).toEqual([]);
  });

  it('refuses anything that is not #rrggbb', async () => {
    for (const color of ['red', 'dc143c', '#dc143', '#dc143cc', '#fff', 'bgc23', 42]) {
      expect(await errorsOf(cls, { ...base, color })).toEqual(['color']);
    }
  });
});

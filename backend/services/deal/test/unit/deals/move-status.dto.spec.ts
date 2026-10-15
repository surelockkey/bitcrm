/**
 * `PUT /deals/:id/status` takes an optional phone fix (owner, 2026-10-15):
 * the mobile app sends where the technician was; the web sends none, and a
 * body without one is exactly today's body. Bounds as `MarkArrivedDto`.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JobSuperStatus } from '@bitcrm/types';
import { MoveStatusDto } from 'src/deals/dto/move-status.dto';

const base = { superStatus: JobSuperStatus.DONE };
const fix = { lat: 41.7637, lng: -72.6851, accuracy: 12 };

const parse = (payload: object) => plainToInstance(MoveStatusDto, payload);
/** The pipe's settings (`main.ts`): unknown keys are dropped, not refused. */
const errorsOf = async (payload: object) => {
  const errors = await validate(parse(payload), { whitelist: true });
  return errors.flatMap((e) => (e.children?.length ? e.children.map((c) => `${e.property}.${c.property}`) : [e.property]));
};

describe('MoveStatusDto.location', () => {
  it('is optional — the web moves a status without one', async () => {
    expect(await errorsOf(base)).toEqual([]);
    expect(parse(base).location).toBeUndefined();
  });

  it('takes a fix with and without accuracy', async () => {
    expect(await errorsOf({ ...base, location: fix })).toEqual([]);
    expect(await errorsOf({ ...base, location: { lat: 41.7637, lng: -72.6851 } })).toEqual([]);
    expect(await errorsOf({ ...base, location: { lat: -90, lng: 180, accuracy: 0 } })).toEqual([]);
    expect(await errorsOf({ ...base, location: { lat: 90, lng: -180, accuracy: 100000 } })).toEqual([]);
  });

  it('refuses a latitude outside −90..90 and a longitude outside −180..180', async () => {
    expect(await errorsOf({ ...base, location: { ...fix, lat: 90.1 } })).toEqual(['location.lat']);
    expect(await errorsOf({ ...base, location: { ...fix, lat: -91 } })).toEqual(['location.lat']);
    expect(await errorsOf({ ...base, location: { ...fix, lng: 180.5 } })).toEqual(['location.lng']);
    expect(await errorsOf({ ...base, location: { ...fix, lng: -181 } })).toEqual(['location.lng']);
  });

  it('refuses an accuracy below 0 or above 100 km', async () => {
    expect(await errorsOf({ ...base, location: { ...fix, accuracy: -1 } })).toEqual(['location.accuracy']);
    expect(await errorsOf({ ...base, location: { ...fix, accuracy: 100001 } })).toEqual(['location.accuracy']);
  });

  it('needs both coordinates, as numbers', async () => {
    expect(await errorsOf({ ...base, location: { lng: fix.lng } })).toEqual(['location.lat']);
    expect(await errorsOf({ ...base, location: { lat: fix.lat } })).toEqual(['location.lng']);
    expect(await errorsOf({ ...base, location: { ...fix, lat: '41.7637' } })).toEqual(['location.lat']);
  });

  it('refuses a location that is not an object', async () => {
    expect(await errorsOf({ ...base, location: 'here' })).toEqual(['location']);
  });

  it('drops what the fix should not carry', async () => {
    const dto = parse({ ...base, location: { ...fix, speed: 30 } });
    await validate(dto, { whitelist: true });
    expect(dto.location).toEqual(fix);
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListContainersQueryDto } from 'src/containers/dto/list-containers-query.dto';
import { ListWarehousesQueryDto } from 'src/warehouses/dto/list-warehouses-query.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorsFor = async (cls: any, payload: unknown) =>
  (await validate(plainToInstance(cls, payload))).map((e) => e.property);

/**
 * Both location lists take the same search box and status toggle the Workiz
 * Inventory tabs have; the container list keeps its department filter too.
 */
describe.each([
  ['ListContainersQueryDto', ListContainersQueryDto],
  ['ListWarehousesQueryDto', ListWarehousesQueryDto],
])('%s', (_name, dto) => {
  it('accepts a search term and a known status', async () => {
    expect(await errorsFor(dto, { search: 'mike', status: 'active' })).toEqual([]);
  });

  it('rejects a status that is not in the enum', async () => {
    expect(await errorsFor(dto, { status: 'deleted' })).toEqual(['status']);
  });

  it('needs neither', async () => {
    expect(await errorsFor(dto, {})).toEqual([]);
  });
});

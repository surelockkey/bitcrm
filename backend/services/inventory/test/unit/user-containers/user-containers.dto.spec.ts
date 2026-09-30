import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserContainerAccess } from '@bitcrm/types';
import { AssignUserContainerDto } from 'src/user-containers/dto/assign-user-container.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorsFor = async (payload: unknown) =>
  (await validate(plainToInstance(AssignUserContainerDto, payload))).map((e) => e.property);

/** Контейнер обов'язковий тоді й лише тоді, коли доступ — "container". */
describe('AssignUserContainerDto', () => {
  it('accepts a container assignment, limited or not', async () => {
    expect(await errorsFor({ userName: 'Mike', access: 'container', containerId: 'c-1' })).toEqual([]);
    expect(
      await errorsFor({ userName: 'Mike', access: 'container', containerId: 'c-1', limited: true }),
    ).toEqual([]);
  });

  it('requires the container id when the access is "container"', async () => {
    expect(await errorsFor({ userName: 'Mike', access: UserContainerAccess.CONTAINER })).toEqual(['containerId']);
    expect(await errorsFor({ userName: 'Mike', access: 'container', containerId: '' })).toEqual(['containerId']);
  });

  it('needs no container for "All locations" or "No access"', async () => {
    expect(await errorsFor({ userName: 'Mike', access: 'all' })).toEqual([]);
    expect(await errorsFor({ userName: 'Mike', access: 'none', containerId: null })).toEqual([]);
  });

  it('requires a user name and a known access', async () => {
    expect(await errorsFor({ access: 'all' })).toEqual(['userName']);
    expect(await errorsFor({ userName: '   ', access: 'all' })).toEqual(['userName']);
    expect(await errorsFor({ userName: 'Mike', access: 'everything' })).toEqual(['access']);
  });

  it('takes limited as a boolean only', async () => {
    expect(
      await errorsFor({ userName: 'Mike', access: 'container', containerId: 'c-1', limited: 'yes' }),
    ).toEqual(['limited']);
  });
});

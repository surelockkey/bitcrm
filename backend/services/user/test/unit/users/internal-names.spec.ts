import { UsersController } from '../../../src/users/users.controller';

/**
 * `POST /users/internal/names-by-ids` — the service-to-service twin of
 * `POST /users/by-ids`. messaging-service side-loads the teammates' names
 * with a page of the inbox; it holds no user token to call the public route
 * with, so it asks here, behind `x-internal-secret`.
 */
describe('UsersController.internalNamesByIds', () => {
  const namesByIds = jest.fn();
  const controller = new UsersController({ namesByIds } as never);

  beforeEach(() => namesByIds.mockReset());

  it('answers the same names-only rows as the public route', async () => {
    namesByIds.mockResolvedValue([{ id: 'u-1', firstName: 'Bob', lastName: 'Ray' }]);

    await expect(controller.internalNamesByIds({ userIds: ['u-1'] })).resolves.toEqual({
      success: true,
      data: [{ id: 'u-1', firstName: 'Bob', lastName: 'Ray' }],
    });
    expect(namesByIds).toHaveBeenCalledWith(['u-1']);
  });

  it('treats a missing list as no ids', async () => {
    namesByIds.mockResolvedValue([]);

    await controller.internalNamesByIds({} as never);

    expect(namesByIds).toHaveBeenCalledWith([]);
  });

  // Nest matches routes in declaration order: after `internal/:id` this would
  // never be reached — though that one is a GET, keep the static route first.
  it('is declared before the internal/:id catch-all', () => {
    const order = Object.getOwnPropertyNames(UsersController.prototype);
    expect(order.indexOf('internalNamesByIds')).toBeGreaterThan(-1);
    expect(order.indexOf('internalNamesByIds')).toBeLessThan(order.indexOf('internalFindById'));
  });
});

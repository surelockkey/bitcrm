import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  InventoryLogAction,
  InventoryStatus,
  LocationType,
  UserContainerAccess,
} from '@bitcrm/types';
import { UserContainersService } from 'src/user-containers/user-containers.service';
import {
  createMockContainer,
  createMockContainersRepository,
  createMockInventoryLogService,
  createMockJwtUser,
  createMockUserContainer,
  createMockUserContainersRepository,
} from '../mocks';

/**
 * Workiz "User containers": у людини рівно один поточний фургон, або "All
 * locations", або "No access"; фургон може мати багато людей. Хтось бере чужий
 * фургон — перепризначення має бути простим і лягати в журнал інвентарю.
 */
describe('UserContainersService', () => {
  let repository: ReturnType<typeof createMockUserContainersRepository>;
  let containers: ReturnType<typeof createMockContainersRepository>;
  let inventoryLog: ReturnType<typeof createMockInventoryLogService>;
  let service: UserContainersService;

  const actor = createMockJwtUser({ id: 'admin-1', email: 'admin@test.com' });

  beforeEach(() => {
    repository = createMockUserContainersRepository();
    containers = createMockContainersRepository();
    containers.findByTechnicianId.mockResolvedValue(null);
    containers.findById.mockImplementation(async (id: string) =>
      createMockContainer({ id, name: `Van ${id}`, technicianId: undefined }),
    );
    inventoryLog = createMockInventoryLogService();
    service = new UserContainersService(repository as any, containers as any, inventoryLog as any);
  });

  describe('reads', () => {
    it('lists every assignment', async () => {
      const rows = [createMockUserContainer()];
      repository.listAll.mockResolvedValue(rows);

      expect(await service.list()).toEqual(rows);
    });

    it('answers one user’s row, 404 when they have none', async () => {
      const row = createMockUserContainer();
      repository.findByUser.mockResolvedValueOnce(row).mockResolvedValueOnce(null);

      expect(await service.findByUser('tech-1')).toEqual(row);
      await expect(service.findByUser('nobody')).rejects.toThrow(NotFoundException);
    });

    it('answers the caller’s own row, 404 when they have none', async () => {
      repository.findByUser.mockResolvedValue(null);

      await expect(service.mine(createMockJwtUser({ id: 'tech-9' }))).rejects.toThrow(NotFoundException);
      expect(repository.findByUser).toHaveBeenCalledWith('tech-9');
    });

    it('lists the users of a container, 404 for a container that does not exist', async () => {
      const rows = [createMockUserContainer({ containerId: 'c-1' })];
      repository.listByContainer.mockResolvedValue(rows);

      expect(await service.listByContainer('c-1')).toEqual(rows);
      expect(repository.listByContainer).toHaveBeenCalledWith('c-1');

      containers.findById.mockResolvedValue(null);
      await expect(service.listByContainer('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assign', () => {
    it('gives a user one container, with its name, and names who did it', async () => {
      const row = await service.assign(
        'tech-1',
        { userName: ' Mike Ross ', access: UserContainerAccess.CONTAINER, containerId: 'c-1', limited: true },
        actor,
      );

      expect(row).toEqual({
        userId: 'tech-1',
        userName: 'Mike Ross',
        access: UserContainerAccess.CONTAINER,
        containerId: 'c-1',
        containerName: 'Van c-1',
        limited: true,
        updatedAt: expect.any(String),
        updatedBy: 'admin-1',
        updatedByName: 'admin@test.com',
      });
      expect(repository.put).toHaveBeenCalledWith(row);
    });

    it('404s on a container that does not exist and writes nothing', async () => {
      containers.findById.mockResolvedValue(null);

      await expect(
        service.assign('tech-1', { userName: 'Mike', access: UserContainerAccess.CONTAINER, containerId: 'x' }, actor),
      ).rejects.toThrow(NotFoundException);
      expect(repository.put).not.toHaveBeenCalled();
    });

    it('refuses an archived container', async () => {
      containers.findById.mockResolvedValue(createMockContainer({ id: 'c-1', status: InventoryStatus.ARCHIVED }));

      await expect(
        service.assign('tech-1', { userName: 'Mike', access: UserContainerAccess.CONTAINER, containerId: 'c-1' }, actor),
      ).rejects.toThrow(/archived/);
      expect(repository.put).not.toHaveBeenCalled();
    });

    it('requires a container id with access "container"', async () => {
      await expect(
        service.assign('tech-1', { userName: 'Mike', access: UserContainerAccess.CONTAINER }, actor),
      ).rejects.toThrow(BadRequestException);
      expect(repository.put).not.toHaveBeenCalled();
    });

    it.each([UserContainerAccess.ALL, UserContainerAccess.NONE])(
      'stores access "%s" with no container and limited false, whatever the body said',
      async (access) => {
        const row = await service.assign(
          'tech-1',
          { userName: 'Mike', access, containerId: 'c-1', limited: true },
          actor,
        );

        expect(row.access).toBe(access);
        expect(row.limited).toBe(false);
        expect(row).not.toHaveProperty('containerId');
        expect(row).not.toHaveProperty('containerName');
        expect(containers.findById).not.toHaveBeenCalled();
      },
    );
  });

  describe('assign — the audit log', () => {
    it('records the move from the old van to the new one', async () => {
      repository.findByUser.mockResolvedValue(
        createMockUserContainer({ containerId: 'c-1', containerName: '(12) MIKE' }),
      );

      await service.assign(
        'tech-1',
        { userName: 'Mike Ross', access: UserContainerAccess.CONTAINER, containerId: 'c-2' },
        actor,
      );

      expect(inventoryLog.record).toHaveBeenCalledWith({
        action: InventoryLogAction.CONTAINER_ASSIGNED,
        subjectUserId: 'tech-1',
        subjectUserName: 'Mike Ross',
        access: UserContainerAccess.CONTAINER,
        fromType: LocationType.CONTAINER,
        fromId: 'c-1',
        fromName: '(12) MIKE',
        toType: LocationType.CONTAINER,
        toId: 'c-2',
        toName: 'Van c-2',
        userId: 'admin-1',
        userName: 'admin@test.com',
      });
    });

    it('records a first assignment with no "from"', async () => {
      await service.assign(
        'tech-1',
        { userName: 'Mike Ross', access: UserContainerAccess.CONTAINER, containerId: 'c-2' },
        actor,
      );

      const entry = inventoryLog.record.mock.calls[0][0];
      expect(entry).toMatchObject({ toId: 'c-2', access: UserContainerAccess.CONTAINER });
      expect(entry).not.toHaveProperty('fromId');
    });

    // До бекфілу старий зв'язок `technicianId` і є попереднім фургоном.
    it('takes the legacy technician link as the previous van when the user has no row yet', async () => {
      containers.findByTechnicianId.mockResolvedValue(createMockContainer({ id: 'c-old', name: '(3) OLD' }));

      await service.assign('tech-1', { userName: 'Mike Ross', access: UserContainerAccess.NONE }, actor);

      const entry = inventoryLog.record.mock.calls[0][0];
      expect(entry).toMatchObject({
        fromType: LocationType.CONTAINER,
        fromId: 'c-old',
        fromName: '(3) OLD',
        access: UserContainerAccess.NONE,
      });
      expect(entry).not.toHaveProperty('toId');
    });

    it('records taking the van away ("All locations") with no "to"', async () => {
      repository.findByUser.mockResolvedValue(createMockUserContainer({ containerId: 'c-1', containerName: 'Van 1' }));

      await service.assign('tech-1', { userName: 'Mike Ross', access: UserContainerAccess.ALL }, actor);

      const entry = inventoryLog.record.mock.calls[0][0];
      expect(entry).toMatchObject({ fromId: 'c-1', access: UserContainerAccess.ALL });
      expect(entry).not.toHaveProperty('toId');
    });

    it('writes no log entry when neither the access nor the container changed', async () => {
      repository.findByUser.mockResolvedValue(createMockUserContainer({ containerId: 'c-1', limited: false }));

      await service.assign(
        'tech-1',
        { userName: 'Mike R.', access: UserContainerAccess.CONTAINER, containerId: 'c-1', limited: true },
        actor,
      );

      expect(repository.put).toHaveBeenCalled();
      expect(inventoryLog.record).not.toHaveBeenCalled();
    });

    it('writes no log entry for "No access" over no row and no van', async () => {
      await service.assign('tech-1', { userName: 'Mike', access: UserContainerAccess.NONE }, actor);

      expect(inventoryLog.record).not.toHaveBeenCalled();
    });

    it('works with no audit log at all', async () => {
      const bare = new UserContainersService(repository as any, containers as any);

      await expect(
        bare.assign('tech-1', { userName: 'Mike', access: UserContainerAccess.CONTAINER, containerId: 'c-1' }, actor),
      ).resolves.toBeDefined();
    });
  });
});

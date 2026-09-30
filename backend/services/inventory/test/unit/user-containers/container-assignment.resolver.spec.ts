import { UserContainerAccess } from '@bitcrm/types';
import { ContainerAssignmentResolver } from 'src/user-containers/container-assignment.resolver';
import {
  createMockContainer,
  createMockContainersRepository,
  createMockUserContainer,
  createMockUserContainersRepository,
} from '../mocks';

/**
 * Один відповідь на "з якого фургона працює ця людина" — для списання на
 * роботу, "мого фургона", обсягу assigned_only і попапу Stock. Рядок
 * призначення вирішує; старий `technicianId` на контейнері — лише запасний
 * шлях, поки на dev не пройшов backfill:user-containers.
 */
describe('ContainerAssignmentResolver', () => {
  let assignments: ReturnType<typeof createMockUserContainersRepository>;
  let containers: ReturnType<typeof createMockContainersRepository>;
  let resolver: ContainerAssignmentResolver;

  beforeEach(() => {
    assignments = createMockUserContainersRepository();
    containers = createMockContainersRepository();
    containers.findByTechnicianId.mockResolvedValue(null);
    resolver = new ContainerAssignmentResolver(assignments as any, containers as any);
  });

  it('answers the assigned container, without looking at the legacy technician link', async () => {
    assignments.findByUser.mockResolvedValue(createMockUserContainer({ containerId: 'c-7' }));

    expect(await resolver.containerIdForUser('tech-1')).toBe('c-7');
    expect(assignments.findByUser).toHaveBeenCalledWith('tech-1');
    expect(containers.findByTechnicianId).not.toHaveBeenCalled();
  });

  // Явне "All locations" / "No access" не повертає старий фургон, навіть якщо
  // контейнер досі тримає `technicianId` цієї людини.
  it.each([UserContainerAccess.ALL, UserContainerAccess.NONE])(
    'answers no container for access "%s", whatever the container rows still say',
    async (access) => {
      assignments.findByUser.mockResolvedValue(
        createMockUserContainer({ access, containerId: undefined, containerName: undefined }),
      );
      containers.findByTechnicianId.mockResolvedValue(createMockContainer({ id: 'c-old' }));

      expect(await resolver.containerIdForUser('tech-1')).toBeUndefined();
      expect(containers.findByTechnicianId).not.toHaveBeenCalled();
    },
  );

  it('falls back to the container that still names the user as its technician when there is no row', async () => {
    containers.findByTechnicianId.mockResolvedValue(createMockContainer({ id: 'c-legacy' }));

    expect(await resolver.containerIdForUser('tech-1')).toBe('c-legacy');
    expect(containers.findByTechnicianId).toHaveBeenCalledWith('tech-1');
  });

  it('answers undefined when neither says anything', async () => {
    expect(await resolver.containerIdForUser('stranger')).toBeUndefined();
  });

  /** Workiz "All locations": жодного одного фургона, але видно всі. */
  describe('assignmentFor', () => {
    it('says "all locations" for access all, with no container', async () => {
      assignments.findByUser.mockResolvedValue(
        createMockUserContainer({ access: UserContainerAccess.ALL, containerId: undefined }),
      );

      expect(await resolver.assignmentFor('tech-1')).toEqual({ allLocations: true });
    });

    it('names the one container for access container, and nothing for none', async () => {
      assignments.findByUser.mockResolvedValueOnce(createMockUserContainer({ containerId: 'c-7' }));
      expect(await resolver.assignmentFor('tech-1')).toEqual({ allLocations: false, containerId: 'c-7' });

      assignments.findByUser.mockResolvedValueOnce(
        createMockUserContainer({ access: UserContainerAccess.NONE, containerId: undefined }),
      );
      expect(await resolver.assignmentFor('tech-1')).toEqual({ allLocations: false });
    });

    it('falls back to the legacy technician link without a row', async () => {
      containers.findByTechnicianId.mockResolvedValue(createMockContainer({ id: 'c-legacy' }));

      expect(await resolver.assignmentFor('tech-1')).toEqual({ allLocations: false, containerId: 'c-legacy' });
    });
  });
});

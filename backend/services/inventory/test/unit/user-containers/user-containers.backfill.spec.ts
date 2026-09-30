import { UserContainerAccess } from '@bitcrm/types';
import { planUserContainerBackfill } from 'src/user-containers/user-containers.backfill';

const NOW = '2026-09-30T09:00:00.000Z';

/**
 * Імпорт Workiz кладе "хто працює з фургоном" на сам контейнер: технік у
 * `technicianId`, другорядні користувачі в `accessUserIds`. Бекфіл переносить
 * це в рядки USER_CONTAINER# — лише для тих, у кого рядка ще немає.
 */
describe('planUserContainerBackfill', () => {
  it('assigns each container’s technician to it, limited as the container says', () => {
    const plan = planUserContainerBackfill(
      [
        { id: 'c-1', name: '(12) MIKE', technicianId: 'u-mike', technicianName: 'Mike Ross', userLimited: true },
        { id: 'c-2', name: '(3) ANN', technicianId: 'u-ann' },
      ],
      new Set(),
      NOW,
    );

    expect(plan.rows).toEqual([
      {
        userId: 'u-mike',
        userName: 'Mike Ross',
        access: UserContainerAccess.CONTAINER,
        containerId: 'c-1',
        containerName: '(12) MIKE',
        limited: true,
        updatedAt: NOW,
        updatedBy: 'system',
        updatedByName: 'backfill:user-containers',
      },
      expect.objectContaining({ userId: 'u-ann', userName: 'u-ann', containerId: 'c-2', limited: false }),
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('assigns the secondary users of a container too, named by their id', () => {
    const plan = planUserContainerBackfill(
      [{ id: 'c-1', name: 'Van', technicianId: 'u-1', accessUserIds: ['u-2', 'u-3'], userLimited: true }],
      new Set(),
      NOW,
    );

    expect(plan.rows.map((r) => [r.userId, r.userName, r.containerId, r.limited])).toEqual([
      ['u-1', 'u-1', 'c-1', true],
      ['u-2', 'u-2', 'c-1', true],
      ['u-3', 'u-3', 'c-1', true],
    ]);
  });

  it('never touches a user who already has a row', () => {
    const plan = planUserContainerBackfill(
      [{ id: 'c-1', name: 'Van', technicianId: 'u-1', accessUserIds: ['u-2'] }],
      new Set(['u-1', 'u-2']),
      NOW,
    );

    expect(plan.rows).toEqual([]);
    expect(plan.alreadyAssigned).toBe(2);
  });

  // Технік як власник фургона важить більше, ніж другорядний доступ деінде,
  // тож техніків проходимо першими; далі — хто перший трапився.
  it('keeps a user’s first container, owners before secondary users, and reports the conflict', () => {
    const plan = planUserContainerBackfill(
      [
        { id: 'c-1', name: 'Van 1', accessUserIds: ['u-1'] },
        { id: 'c-2', name: 'Van 2', technicianId: 'u-1' },
        { id: 'c-3', name: 'Van 3', technicianId: 'u-1' },
      ],
      new Set(),
      NOW,
    );

    expect(plan.rows.map((r) => [r.userId, r.containerId])).toEqual([['u-1', 'c-2']]);
    expect(plan.conflicts).toEqual([
      { userId: 'u-1', keptContainerId: 'c-2', skippedContainerId: 'c-3' },
      { userId: 'u-1', keptContainerId: 'c-2', skippedContainerId: 'c-1' },
    ]);
  });

  it('is no conflict when the technician is also listed among the container’s users', () => {
    const plan = planUserContainerBackfill(
      [{ id: 'c-1', name: 'Van', technicianId: 'u-1', accessUserIds: ['u-1'] }],
      new Set(),
      NOW,
    );

    expect(plan.rows).toHaveLength(1);
    expect(plan.conflicts).toEqual([]);
  });

  it('names a container written before containers had a name the way the list does', () => {
    const plan = planUserContainerBackfill(
      [
        { id: 'c-1', technicianId: 'u-1', technicianName: 'Mike Ross' },
        { id: 'c-2', accessUserIds: ['u-2'] },
      ],
      new Set(),
      NOW,
    );

    expect(plan.rows.map((r) => r.containerName)).toEqual(["Mike Ross's van", 'Container']);
  });

  it('ignores containers nobody works from', () => {
    const plan = planUserContainerBackfill([{ id: 'c-1', name: 'Spare', accessUserIds: [] }], new Set(), NOW);

    expect(plan).toEqual({ rows: [], conflicts: [], alreadyAssigned: 0 });
  });
});

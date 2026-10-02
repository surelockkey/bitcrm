import { NotFoundException } from '@nestjs/common';
import { type ItemGroup } from '@bitcrm/types';
import { ItemGroupsService } from 'src/item-groups/item-groups.service';

const group = (over: Partial<ItemGroup>): ItemGroup => ({
  id: 'g',
  name: 'Group',
  description: '',
  members: [],
  total: 0,
  ...over,
});

describe('ItemGroupsService', () => {
  const repository = { listAll: jest.fn(), get: jest.fn() };
  const service = new ItemGroupsService(repository as any);

  beforeEach(() => jest.clearAllMocks());

  it('lists the groups by name, case-insensitively, as Workiz does', async () => {
    repository.listAll.mockResolvedValue([
      group({ id: '1', name: 'Sliding 60 x 80 estimate' }),
      group({ id: '2', name: '7QUO80 ESTIMATE' }),
      group({ id: '3', name: 'commercial door' }),
    ]);

    const list = await service.list();

    expect(list.map((g) => g.name)).toEqual(['7QUO80 ESTIMATE', 'commercial door', 'Sliding 60 x 80 estimate']);
  });

  it('finds one group by id', async () => {
    repository.get.mockResolvedValue(group({ id: 'g-1' }));

    await expect(service.findById('g-1')).resolves.toMatchObject({ id: 'g-1' });
    expect(repository.get).toHaveBeenCalledWith('g-1');
  });

  it('answers 404 for a group that is not there', async () => {
    repository.get.mockResolvedValue(null);

    await expect(service.findById('nope')).rejects.toThrow(new NotFoundException('Item group nope not found'));
  });
});

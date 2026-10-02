import { Injectable, NotFoundException } from '@nestjs/common';
import { type ItemGroup } from '@bitcrm/types';
import { ItemGroupsRepository } from './item-groups.repository';

@Injectable()
export class ItemGroupsService {
  constructor(private readonly repository: ItemGroupsRepository) {}

  /** Every group, by name (case-insensitive) — the order Workiz's picker shows. */
  async list(): Promise<ItemGroup[]> {
    const groups = await this.repository.listAll();
    return groups.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  async findById(id: string): Promise<ItemGroup> {
    const group = await this.repository.get(id);
    if (!group) throw new NotFoundException(`Item group ${id} not found`);
    return group;
  }
}

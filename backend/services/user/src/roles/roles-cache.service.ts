import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type ResolvedPermissions } from '@bitcrm/types';

@Injectable()
export class RolesCacheService {
  constructor(private readonly redis: RedisService) {}

  async getRolePermissions(roleId: string): Promise<any | null> {
    const data = await this.redis.client.get(`role:permissions:${roleId}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async setRolePermissions(roleId: string, data: any): Promise<void> {
    await this.redis.client.set(
      `role:permissions:${roleId}`,
      JSON.stringify(data),
      'EX',
      60,
    );
  }

  async invalidateRole(roleId: string): Promise<void> {
    await this.redis.client.del(`role:permissions:${roleId}`);
  }

  async getUserPermissions(userId: string): Promise<ResolvedPermissions | null> {
    const data = await this.redis.client.get(`user:permissions:${userId}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async setUserPermissions(userId: string, data: ResolvedPermissions): Promise<void> {
    await this.redis.client.set(
      `user:permissions:${userId}`,
      JSON.stringify(data),
      'EX',
      60,
    );
  }

  async invalidateUserPermissions(userId: string): Promise<void> {
    await this.redis.client.del(`user:permissions:${userId}`);
  }

  async invalidateAllUsersWithRole(roleId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    for (const userId of userIds) {
      await this.redis.client.del(`user:permissions:${userId}`);
    }
  }
}

import { Test, TestingModule } from '@nestjs/testing';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { InventoryLogController } from 'src/inventory-log/inventory-log.controller';
import { InventoryLogService } from 'src/inventory-log/inventory-log.service';
import { createMockInventoryLogEntry, createMockInventoryLogService } from '../mocks';

describe('InventoryLogController', () => {
  let controller: InventoryLogController;
  let service: ReturnType<typeof createMockInventoryLogService>;

  beforeEach(async () => {
    service = createMockInventoryLogService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryLogController],
      providers: [{ provide: InventoryLogService, useValue: service }],
    }).compile();

    controller = module.get<InventoryLogController>(InventoryLogController);
  });

  describe('list', () => {
    it('answers the page in the standard envelope with pagination', async () => {
      const entry = createMockInventoryLogEntry();
      service.list.mockResolvedValue({ items: [entry], nextCursor: 'abc' });
      const query = { userId: 'user-1', limit: 20 };

      const result = await controller.list(query as never);

      expect(result).toEqual({
        success: true,
        data: [entry],
        pagination: { nextCursor: 'abc', count: 1 },
      });
      expect(service.list).toHaveBeenCalledWith(query);
    });
  });

  describe('count', () => {
    it('answers the total in the envelope', async () => {
      service.count.mockResolvedValue({ total: 18, atLeast: false });
      const query = { from: '2026-09-01T00:00:00.000Z' };

      const result = await controller.count(query as never);

      expect(result).toEqual({ success: true, data: { total: 18, atLeast: false } });
      expect(service.count).toHaveBeenCalledWith(query);
    });
  });

  /** The log is a report: whoever reads reports reads it, nobody else. */
  it('gates both routes behind reports.view', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, controller.list)).toEqual({ resource: 'reports', action: 'view' });
    expect(Reflect.getMetadata(PERMISSION_KEY, controller.count)).toEqual({ resource: 'reports', action: 'view' });
  });

  it('serves the count under its own path', () => {
    expect(Reflect.getMetadata('path', controller.count)).toBe('count');
  });
});

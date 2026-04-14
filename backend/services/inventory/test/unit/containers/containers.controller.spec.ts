import { Test, TestingModule } from '@nestjs/testing';
import { ContainersController } from 'src/containers/containers.controller';
import { ContainersService } from 'src/containers/containers.service';
import {
  createMockContainer,
  createMockEnsureContainerDto,
  createMockStockItem,
  createMockJwtUser,
} from '../mocks';

describe('ContainersController', () => {
  let controller: ContainersController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      getMyContainer: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      getStock: jest.fn(),
      ensureContainer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContainersController],
      providers: [{ provide: ContainersService, useValue: service }],
    }).compile();

    controller = module.get<ContainersController>(ContainersController);
  });

  describe('getMyContainer', () => {
    it('should return success with container', async () => {
      const container = createMockContainer();
      const user = createMockJwtUser();
      service.getMyContainer.mockResolvedValue(container);

      const result = await controller.getMyContainer(user);

      expect(result).toEqual({ success: true, data: container });
      expect(service.getMyContainer).toHaveBeenCalledWith(user);
    });
  });

  describe('list', () => {
    it('should return success with items and pagination', async () => {
      const container = createMockContainer();
      const user = createMockJwtUser();
      const req = { resolvedPermissions: { dataScope: { containers: 'all' } } };
      service.list.mockResolvedValue({ items: [container], nextCursor: undefined });

      const result = await controller.list({ limit: 20 } as any, user, req);

      expect(result).toEqual({
        success: true,
        data: [container],
        pagination: { nextCursor: undefined, count: 1 },
      });
      expect(service.list).toHaveBeenCalledWith({ limit: 20 }, user, 'all');
    });
  });

  describe('findById', () => {
    it('should return success with container', async () => {
      const container = createMockContainer();
      service.findById.mockResolvedValue(container);

      const result = await controller.findById('container-1');

      expect(result).toEqual({ success: true, data: container });
      expect(service.findById).toHaveBeenCalledWith('container-1');
    });
  });

  describe('getStock', () => {
    it('should return success with stock items', async () => {
      const stockItems = [createMockStockItem()];
      service.getStock.mockResolvedValue(stockItems);

      const result = await controller.getStock('container-1');

      expect(result).toEqual({ success: true, data: stockItems });
      expect(service.getStock).toHaveBeenCalledWith('container-1');
    });
  });

  describe('ensureContainer', () => {
    it('should return success with ensured container', async () => {
      const container = createMockContainer();
      const dto = createMockEnsureContainerDto();
      service.ensureContainer.mockResolvedValue(container);

      const result = await controller.ensureContainer(dto);

      expect(result).toEqual({ success: true, data: container });
      expect(service.ensureContainer).toHaveBeenCalledWith(dto);
    });
  });
});

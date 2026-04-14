import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InventoryStatus } from '@bitcrm/types';
import { ContainersService } from 'src/containers/containers.service';
import { ContainersRepository } from 'src/containers/containers.repository';
import { StockRepository } from 'src/stock/stock.repository';
import {
  createMockContainer,
  createMockEnsureContainerDto,
  createMockStockItem,
  createMockJwtUser,
  createMockContainersRepository,
  createMockStockRepository,
} from '../mocks';

describe('ContainersService', () => {
  let service: ContainersService;
  let repository: ReturnType<typeof createMockContainersRepository>;
  let stockRepository: ReturnType<typeof createMockStockRepository>;

  beforeEach(async () => {
    repository = createMockContainersRepository();
    stockRepository = createMockStockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainersService,
        { provide: ContainersRepository, useValue: repository },
        { provide: StockRepository, useValue: stockRepository },
      ],
    }).compile();

    service = module.get<ContainersService>(ContainersService);
  });

  describe('ensureContainer', () => {
    it('should return existing container if found by technicianId', async () => {
      const container = createMockContainer();
      repository.findByTechnicianId.mockResolvedValue(container);

      const result = await service.ensureContainer(createMockEnsureContainerDto());

      expect(result).toEqual(container);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should create new container if not found', async () => {
      repository.findByTechnicianId.mockResolvedValue(null);
      repository.create.mockResolvedValue(undefined);

      const result = await service.ensureContainer(createMockEnsureContainerDto());

      expect(result.id).toBeDefined();
      expect(result.status).toBe(InventoryStatus.ACTIVE);
      expect(result.technicianId).toBe('tech-1');
      expect(repository.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMyContainer', () => {
    it('should return existing container for user', async () => {
      const container = createMockContainer();
      const user = createMockJwtUser({ id: 'tech-1' });
      repository.findByTechnicianId.mockResolvedValue(container);

      const result = await service.getMyContainer(user);

      expect(result).toEqual(container);
    });

    it('should lazily create container for technician role', async () => {
      const user = createMockJwtUser({ id: 'tech-1', roleId: 'role-technician', email: 'tech@test.com', department: 'Atlanta' });
      repository.findByTechnicianId
        .mockResolvedValueOnce(null)  // getMyContainer lookup
        .mockResolvedValueOnce(null); // ensureContainer lookup
      repository.create.mockResolvedValue(undefined);

      const result = await service.getMyContainer(user);

      expect(result.technicianId).toBe('tech-1');
      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException for non-technician without container', async () => {
      const user = createMockJwtUser({ roleId: 'role-admin' });
      repository.findByTechnicianId.mockResolvedValue(null);

      await expect(service.getMyContainer(user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findById', () => {
    it('should return container when found', async () => {
      const container = createMockContainer();
      repository.findById.mockResolvedValue(container);

      const result = await service.findById('container-1');

      expect(result).toEqual(container);
    });

    it('should throw NotFoundException when not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('should return all containers when dataScope is not restricted', async () => {
      const paginated = { items: [createMockContainer()], nextCursor: undefined };
      repository.findAll.mockResolvedValue(paginated);

      const result = await service.list({ limit: 20 } as any);

      expect(result).toEqual(paginated);
    });

    it('should filter by assigned_only dataScope', async () => {
      const container = createMockContainer();
      const user = createMockJwtUser({ id: 'tech-1' });
      repository.findByTechnicianId.mockResolvedValue(container);

      const result = await service.list({ limit: 20 } as any, user, 'assigned_only');

      expect(result.items).toEqual([container]);
      expect(repository.findAll).not.toHaveBeenCalled();
    });

    it('should return empty array for assigned_only when no container exists', async () => {
      const user = createMockJwtUser();
      repository.findByTechnicianId.mockResolvedValue(null);

      const result = await service.list({ limit: 20 } as any, user, 'assigned_only');

      expect(result.items).toEqual([]);
    });

    it('should filter by department dataScope', async () => {
      const paginated = { items: [createMockContainer()], nextCursor: undefined };
      const user = createMockJwtUser({ department: 'Atlanta' });
      repository.findAll.mockResolvedValue(paginated);

      await service.list({ limit: 20 } as any, user, 'department');

      expect(repository.findAll).toHaveBeenCalledWith(20, undefined, { department: 'Atlanta' });
    });
  });

  describe('getStock', () => {
    it('should return stock levels for container', async () => {
      const container = createMockContainer();
      const stockItems = [createMockStockItem()];
      repository.findById.mockResolvedValue(container);
      stockRepository.getStockLevels.mockResolvedValue(stockItems);

      const result = await service.getStock('container-1');

      expect(result).toEqual(stockItems);
      expect(stockRepository.getStockLevels).toHaveBeenCalledWith('CONTAINER#container-1');
    });

    it('should throw NotFoundException if container does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getStock('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

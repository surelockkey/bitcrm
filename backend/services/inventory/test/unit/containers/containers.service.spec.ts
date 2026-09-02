import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryStatus } from '@bitcrm/types';
import { SnsPublisherService } from '@bitcrm/shared';
import { ContainersService } from 'src/containers/containers.service';
import { ContainersRepository } from 'src/containers/containers.repository';
import { StockRepository } from 'src/stock/stock.repository';
import {
  createMockContainer,
  createMockCreateContainerDto,
  createMockStockItem,
  createMockJwtUser,
  createMockContainersRepository,
  createMockStockRepository,
} from '../mocks';

describe('ContainersService', () => {
  let service: ContainersService;
  let repository: ReturnType<typeof createMockContainersRepository>;
  let stockRepository: ReturnType<typeof createMockStockRepository>;

  let publisher: { publish: jest.Mock };

  beforeEach(async () => {
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    repository = createMockContainersRepository();
    stockRepository = createMockStockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainersService,
        { provide: ContainersRepository, useValue: repository },
        { provide: StockRepository, useValue: stockRepository },
        { provide: SnsPublisherService, useValue: publisher },
      ],
    }).compile();

    service = module.get<ContainersService>(ContainersService);
  });

  describe('create', () => {
    it('should create a container with UUID and ACTIVE status', async () => {
      repository.create.mockResolvedValue(undefined);

      const result = await service.create(createMockCreateContainerDto());

      expect(result.id).toBeDefined();
      expect(result.name).toBe('Van 1');
      expect(result.description).toBe('North route van');
      expect(result.status).toBe(InventoryStatus.ACTIVE);
      expect(result.technicianId).toBeUndefined();
      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(publisher.publish).toHaveBeenCalledWith('inventory-events', 'container.created', {
        containerId: result.id,
      });
    });

    it('should create with a technician assigned when the tech is free', async () => {
      repository.findByTechnicianId.mockResolvedValue(null);
      repository.create.mockResolvedValue(undefined);

      const result = await service.create(
        createMockCreateContainerDto({ technicianId: 'tech-1', technicianName: 'John Doe' }),
      );

      expect(result.technicianId).toBe('tech-1');
      expect(result.technicianName).toBe('John Doe');
    });

    it('should reject creating with a technician already assigned elsewhere', async () => {
      repository.findByTechnicianId.mockResolvedValue(createMockContainer({ id: 'other' }));

      await expect(
        service.create(createMockCreateContainerDto({ technicianId: 'tech-1' })),
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('getMyContainer', () => {
    it('should return the container assigned to the user', async () => {
      const container = createMockContainer();
      const user = createMockJwtUser({ id: 'tech-1' });
      repository.findByTechnicianId.mockResolvedValue(container);

      const result = await service.getMyContainer(user);

      expect(result).toEqual(container);
    });

    it('should throw NotFoundException when nothing is assigned (no lazy creation)', async () => {
      const user = createMockJwtUser({ id: 'tech-1', roleId: 'role-technician' });
      repository.findByTechnicianId.mockResolvedValue(null);

      await expect(service.getMyContainer(user)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.create).not.toHaveBeenCalled();
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

  describe('update', () => {
    it('should update name, description and department', async () => {
      const container = createMockContainer();
      const updated = createMockContainer({ name: 'Van 2', description: 'South' });
      repository.findById.mockResolvedValue(container);
      repository.update.mockResolvedValue(updated);

      const result = await service.update('container-1', {
        name: 'Van 2',
        description: 'South',
        department: 'Locksmith North',
      });

      expect(result).toEqual(updated);
      expect(repository.update).toHaveBeenCalledWith('container-1', {
        name: 'Van 2',
        description: 'South',
        department: 'Locksmith North',
      });
    });

    it('should assign a free technician', async () => {
      const container = createMockContainer({ technicianId: undefined, technicianName: undefined });
      repository.findById.mockResolvedValue(container);
      repository.findByTechnicianId.mockResolvedValue(null);
      repository.update.mockResolvedValue(
        createMockContainer({ technicianId: 'tech-9', technicianName: 'Ann Lee' }),
      );

      const result = await service.update('container-1', {
        technicianId: 'tech-9',
        technicianName: 'Ann Lee',
      });

      expect(result.technicianId).toBe('tech-9');
      expect(repository.update).toHaveBeenCalledWith('container-1', {
        technicianId: 'tech-9',
        technicianName: 'Ann Lee',
      });
    });

    it('should allow re-saving the container with its own technician', async () => {
      const container = createMockContainer({ technicianId: 'tech-1' });
      repository.findById.mockResolvedValue(container);
      repository.findByTechnicianId.mockResolvedValue(container);
      repository.update.mockResolvedValue(container);

      await expect(
        service.update('container-1', { technicianId: 'tech-1' }),
      ).resolves.toBeDefined();
    });

    it('should reject assigning a technician who has another container', async () => {
      const container = createMockContainer({ technicianId: undefined });
      repository.findById.mockResolvedValue(container);
      repository.findByTechnicianId.mockResolvedValue(
        createMockContainer({ id: 'other-container', technicianId: 'tech-9' }),
      );

      await expect(
        service.update('container-1', { technicianId: 'tech-9' }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should unassign the technician when technicianId is null', async () => {
      const container = createMockContainer();
      repository.findById.mockResolvedValue(container);
      repository.update.mockResolvedValue(
        createMockContainer({ technicianId: undefined, technicianName: undefined }),
      );

      const result = await service.update('container-1', { technicianId: null });

      expect(result.technicianId).toBeUndefined();
      expect(repository.update).toHaveBeenCalledWith('container-1', {
        technicianId: null,
        technicianName: null,
      });
    });

    it('should allow deactivating via status', async () => {
      const container = createMockContainer();
      const archived = createMockContainer({ status: InventoryStatus.ARCHIVED });
      repository.findById.mockResolvedValue(container);
      repository.update.mockResolvedValue(archived);

      const result = await service.update('container-1', {
        status: InventoryStatus.ARCHIVED,
      });

      expect(result.status).toBe(InventoryStatus.ARCHIVED);
    });

    it('should throw NotFoundException when container does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { department: 'X' }),
      ).rejects.toThrow(NotFoundException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should publish container.updated', async () => {
      const container = createMockContainer();
      repository.findById.mockResolvedValue(container);
      repository.update.mockResolvedValue(container);

      await service.update('container-1', { department: 'X' });

      expect(publisher.publish).toHaveBeenCalledWith(
        'inventory-events',
        'container.updated',
        { containerId: 'container-1' },
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

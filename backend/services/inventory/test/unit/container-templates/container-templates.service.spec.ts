import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InventoryStatus } from '@bitcrm/types';
import { ContainerTemplatesService } from 'src/container-templates/container-templates.service';
import { ContainerTemplatesRepository } from 'src/container-templates/container-templates.repository';
import { ContainersRepository } from 'src/containers/containers.repository';
import { ProductsRepository } from 'src/products/products.repository';
import { StockRepository } from 'src/stock/stock.repository';
import {
  createMockContainer,
  createMockContainerTemplate,
  createMockContainerTemplatesRepository,
  createMockContainersRepository,
  createMockCreateContainerTemplateDto,
  createMockProduct,
  createMockProductsRepository,
  createMockStockItem,
  createMockStockRepository,
} from '../mocks';

describe('ContainerTemplatesService', () => {
  let service: ContainerTemplatesService;
  let repository: ReturnType<typeof createMockContainerTemplatesRepository>;
  let containersRepository: ReturnType<typeof createMockContainersRepository>;
  let productsRepository: ReturnType<typeof createMockProductsRepository>;
  let stockRepository: ReturnType<typeof createMockStockRepository>;

  beforeEach(async () => {
    repository = createMockContainerTemplatesRepository();
    containersRepository = createMockContainersRepository();
    productsRepository = createMockProductsRepository();
    stockRepository = createMockStockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerTemplatesService,
        { provide: ContainerTemplatesRepository, useValue: repository },
        { provide: ContainersRepository, useValue: containersRepository },
        { provide: ProductsRepository, useValue: productsRepository },
        { provide: StockRepository, useValue: stockRepository },
      ],
    }).compile();

    service = module.get<ContainerTemplatesService>(ContainerTemplatesService);
  });

  describe('create', () => {
    beforeEach(() => {
      repository.findByName.mockResolvedValue(null);
      productsRepository.findById.mockResolvedValue(createMockProduct());
    });

    it('denormalizes product name and sku onto each line', async () => {
      const result = await service.create(createMockCreateContainerTemplateDto());

      expect(result.items).toEqual([
        {
          productId: 'prod-1',
          productName: 'Test Product',
          sku: 'SKU-001',
          quantity: 10,
        },
      ]);
      expect(result.status).toBe(InventoryStatus.ACTIVE);
      expect(result.id).toBeDefined();
      expect(repository.create).toHaveBeenCalled();
    });

    it('rejects a duplicate name regardless of case', async () => {
      repository.findByName.mockResolvedValue(
        createMockContainerTemplate({ name: 'standard van' }),
      );

      await expect(
        service.create(createMockCreateContainerTemplateDto({ name: 'STANDARD VAN' })),
      ).rejects.toThrow(ConflictException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects a line pointing at a product that does not exist', async () => {
      productsRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(createMockCreateContainerTemplateDto()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects the same product listed twice', async () => {
      await expect(
        service.create(
          createMockCreateContainerTemplateDto({
            items: [
              { productId: 'prod-1', quantity: 5 },
              { productId: 'prod-1', quantity: 3 },
            ],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('throws when the template is missing', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('diffForContainer', () => {
    it('reports the shortfall between target and stock on hand', async () => {
      containersRepository.findById.mockResolvedValue(
        createMockContainer({ templateId: 'tpl-1' }),
      );
      repository.findById.mockResolvedValue(
        createMockContainerTemplate({
          items: [
            { productId: 'prod-1', productName: 'Lock', sku: 'SKU-001', quantity: 10 },
            { productId: 'prod-2', productName: 'Key', sku: 'SKU-002', quantity: 4 },
          ],
        }),
      );
      stockRepository.getStockLevels.mockResolvedValue([
        createMockStockItem({ productId: 'prod-1', quantity: 3 }),
      ]);

      const result = await service.diffForContainer('container-1');

      expect(result.lines).toEqual([
        {
          productId: 'prod-1',
          productName: 'Lock',
          sku: 'SKU-001',
          target: 10,
          onHand: 3,
          missing: 7,
        },
        {
          productId: 'prod-2',
          productName: 'Key',
          sku: 'SKU-002',
          target: 4,
          onHand: 0,
          missing: 4,
        },
      ]);
      expect(result.shortLineCount).toBe(2);
    });

    it('floors missing at zero when the van is overstocked', async () => {
      containersRepository.findById.mockResolvedValue(
        createMockContainer({ templateId: 'tpl-1' }),
      );
      repository.findById.mockResolvedValue(createMockContainerTemplate());
      stockRepository.getStockLevels.mockResolvedValue([
        createMockStockItem({ productId: 'prod-1', quantity: 25 }),
      ]);

      const result = await service.diffForContainer('container-1');

      expect(result.lines[0].missing).toBe(0);
      expect(result.shortLineCount).toBe(0);
    });

    it('reads the container stock from the container partition', async () => {
      containersRepository.findById.mockResolvedValue(
        createMockContainer({ templateId: 'tpl-1' }),
      );
      repository.findById.mockResolvedValue(createMockContainerTemplate());
      stockRepository.getStockLevels.mockResolvedValue([]);

      await service.diffForContainer('container-1');

      expect(stockRepository.getStockLevels).toHaveBeenCalledWith(
        'CONTAINER#container-1',
      );
    });

    it('throws when the container has no template assigned', async () => {
      containersRepository.findById.mockResolvedValue(createMockContainer());

      await expect(service.diffForContainer('container-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws when the container itself is missing', async () => {
      containersRepository.findById.mockResolvedValue(null);

      await expect(service.diffForContainer('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

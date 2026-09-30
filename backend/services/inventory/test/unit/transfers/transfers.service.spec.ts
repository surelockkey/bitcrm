import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryLogAction, InventoryStatus, ReturnReason, TransferType, LocationType } from '@bitcrm/types';
import { SnsPublisherService, RedisService } from '@bitcrm/shared';
import { TransfersService } from 'src/transfers/transfers.service';
import { TransfersRepository } from 'src/transfers/transfers.repository';
import { StockService } from 'src/stock/stock.service';
import { LocationsRepository } from 'src/stock/locations.repository';
import { ContainerAssignmentResolver } from 'src/user-containers/container-assignment.resolver';
import { ProductsService } from 'src/products/products.service';
import { InventoryLogService } from 'src/inventory-log/inventory-log.service';
import {
  createMockTransfer,
  createMockCreateTransferDto,
  createMockJwtUser,
  createMockLocationSummary,
  createMockProduct,
  createMockTransfersRepository,
  createMockStockService,
  createMockProductsService,
  createMockLocationsRepository,
  createMockInventoryLogService,
  createMockContainerAssignmentResolver,
} from '../mocks';

describe('TransfersService', () => {
  let service: TransfersService;
  let repository: ReturnType<typeof createMockTransfersRepository>;
  let stockService: ReturnType<typeof createMockStockService>;
  let assignments: ReturnType<typeof createMockContainerAssignmentResolver>;
  let productsService: ReturnType<typeof createMockProductsService>;
  let locationsRepository: ReturnType<typeof createMockLocationsRepository>;
  let inventoryLog: ReturnType<typeof createMockInventoryLogService>;

  let publisher: { publish: jest.Mock };

  beforeEach(async () => {
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    repository = createMockTransfersRepository();
    stockService = createMockStockService();
    productsService = createMockProductsService();
    locationsRepository = createMockLocationsRepository();
    inventoryLog = createMockInventoryLogService();
    // Default: the id is not a user with a container, so it's treated as a container id.
    assignments = createMockContainerAssignmentResolver();
    // Default: every location named in a request exists.
    locationsRepository.findLocation.mockImplementation(async (type: LocationType, id: string) =>
      createMockLocationSummary({
        type: type === LocationType.WAREHOUSE ? 'warehouse' : 'container',
        id,
        name: id,
      }),
    );
    const store = new Map<string, string>();
    const redis = {
      client: {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: TransfersRepository, useValue: repository },
        { provide: StockService, useValue: stockService },
        { provide: ContainerAssignmentResolver, useValue: assignments },
        { provide: ProductsService, useValue: productsService },
        { provide: LocationsRepository, useValue: locationsRepository },
        { provide: InventoryLogService, useValue: inventoryLog },
        { provide: SnsPublisherService, useValue: publisher },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<TransfersService>(TransfersService);
  });

  describe('createTransfer', () => {
    it('should validate route, call StockService.transfer, and create transfer record', async () => {
      const dto = createMockCreateTransferDto();
      const user = createMockJwtUser();
      stockService.transfer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      const result = await service.createTransfer(dto, user);

      expect(result.id).toBeDefined();
      expect(result.type).toBe(TransferType.TRANSFER);
      expect(result.performedBy).toBe(user.id);
      expect(result.performedByName).toBe(user.email);
      expect(stockService.transfer).toHaveBeenCalledWith(
        'WAREHOUSE#wh-1',
        'CONTAINER#container-1',
        dto.items,
      );
      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(publisher.publish).toHaveBeenCalledWith('inventory-events', 'transfer.created', {
        transferId: result.id,
      });
    });

    it('should allow container->warehouse transfers', async () => {
      const dto = createMockCreateTransferDto({
        fromType: LocationType.CONTAINER,
        fromId: 'container-1',
        toType: LocationType.WAREHOUSE,
        toId: 'wh-1',
      });
      const user = createMockJwtUser();
      stockService.transfer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      const result = await service.createTransfer(dto, user);

      expect(result.type).toBe(TransferType.TRANSFER);
    });

    it('should allow container->container transfers', async () => {
      const dto = createMockCreateTransferDto({
        fromType: LocationType.CONTAINER,
        fromId: 'container-1',
        toType: LocationType.CONTAINER,
        toId: 'container-2',
      });
      const user = createMockJwtUser();
      stockService.transfer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      const result = await service.createTransfer(dto, user);

      expect(result.type).toBe(TransferType.TRANSFER);
    });

    it('should reject invalid routes (supplier->container)', async () => {
      const dto = createMockCreateTransferDto({
        fromType: LocationType.SUPPLIER,
        fromId: 'sup-1',
        toType: LocationType.CONTAINER,
        toId: 'container-1',
      });
      const user = createMockJwtUser();

      await expect(service.createTransfer(dto, user)).rejects.toThrow(
        BadRequestException,
      );
      expect(stockService.transfer).not.toHaveBeenCalled();
    });

    // Workiz moves stock between stores too.
    it('allows warehouse->warehouse transfers', async () => {
      const dto = createMockCreateTransferDto({
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-1',
        toType: LocationType.WAREHOUSE,
        toId: 'wh-2',
      });
      const user = createMockJwtUser();
      stockService.transfer.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      const result = await service.createTransfer(dto, user);

      expect(result.type).toBe(TransferType.TRANSFER);
      expect(stockService.transfer).toHaveBeenCalledWith('WAREHOUSE#wh-1', 'WAREHOUSE#wh-2', dto.items);
    });

    /** Журнал: кожен рядок руху названий з обох боків, як у Workiz "from Taras's van to Main". */
    it('records stock_moved per item with both location names', async () => {
      const dto = createMockCreateTransferDto({
        items: [
          { productId: 'prod-1', productName: 'Deadbolt', quantity: 2 },
          { productId: 'prod-2', productName: 'Knob', quantity: 1 },
        ],
      });
      const user = createMockJwtUser();
      locationsRepository.findLocation.mockImplementation(async (type: LocationType, id: string) =>
        type === LocationType.WAREHOUSE
          ? createMockLocationSummary({ type: 'warehouse', id, name: 'Main Warehouse' })
          : createMockLocationSummary({ type: 'container', id, name: "Taras's van" }),
      );
      productsService.loadForStock.mockImplementation(async (id: string) =>
        createMockProduct({ id, name: id === 'prod-1' ? 'Deadbolt' : 'Knob', sku: 'SKU-001' }),
      );

      await service.createTransfer(dto, user);

      expect(locationsRepository.findLocation).toHaveBeenCalledWith(LocationType.WAREHOUSE, 'wh-1');
      expect(locationsRepository.findLocation).toHaveBeenCalledWith(LocationType.CONTAINER, 'container-1');
      expect(inventoryLog.record).toHaveBeenCalledTimes(2);
      expect(inventoryLog.record).toHaveBeenNthCalledWith(1, {
        action: InventoryLogAction.STOCK_MOVED,
        productId: 'prod-1',
        productName: 'Deadbolt',
        sku: 'SKU-001',
        quantity: 2,
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-1',
        fromName: 'Main Warehouse',
        toType: LocationType.CONTAINER,
        toId: 'container-1',
        toName: "Taras's van",
        userId: user.id,
        userName: user.email,
        category: 'Locks',
      });
      expect(inventoryLog.record).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ productId: 'prod-2', quantity: 1 }),
      );
    });

    // Раніше `toId: 'typo'` проходило: одиниці зникали з реального складу і
    // лягали під ключ без рядка локації — невидимі всім спискам, але в onHand.
    it('404s when either location has no row, before touching stock', async () => {
      const dto = createMockCreateTransferDto({ toId: 'typo' });
      locationsRepository.findLocation.mockImplementation(async (_type: LocationType, id: string) =>
        id === 'typo' ? null : createMockLocationSummary({ id }),
      );

      await expect(service.createTransfer(dto, createMockJwtUser())).rejects.toThrow(NotFoundException);
      expect(stockService.transfer).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    // В архівну локацію нічого не переміщуємо; з архівної — можна (розвантажити
    // списаний фургон).
    it('refuses to move stock into an archived location, before touching stock', async () => {
      const dto = createMockCreateTransferDto({ toId: 'old-van' });
      locationsRepository.findLocation.mockImplementation(async (_type: LocationType, id: string) =>
        createMockLocationSummary({
          id,
          name: id === 'old-van' ? '(9) OLD VAN' : id,
          status: id === 'old-van' ? InventoryStatus.ARCHIVED : InventoryStatus.ACTIVE,
        }),
      );

      await expect(service.createTransfer(dto, createMockJwtUser())).rejects.toThrow(
        new BadRequestException('Container "(9) OLD VAN" is archived'),
      );
      expect(stockService.transfer).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('still moves stock out of an archived location', async () => {
      const dto = createMockCreateTransferDto({ fromId: 'old-store' });
      locationsRepository.findLocation.mockImplementation(async (_type: LocationType, id: string) =>
        createMockLocationSummary({
          id,
          status: id === 'old-store' ? InventoryStatus.ARCHIVED : InventoryStatus.ACTIVE,
        }),
      );

      await expect(service.createTransfer(dto, createMockJwtUser())).resolves.toBeDefined();
      expect(stockService.transfer).toHaveBeenCalled();
    });

    it('rejects a move from a location to itself', async () => {
      const dto = createMockCreateTransferDto({
        fromType: LocationType.CONTAINER,
        fromId: 'container-1',
        toType: LocationType.CONTAINER,
        toId: 'container-1',
      });

      await expect(service.createTransfer(dto, createMockJwtUser())).rejects.toThrow(BadRequestException);
      expect(stockService.transfer).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    // Те саме правило, що й на отриманні: некерований товар не має лічильника,
    // тож його не можна ні прийняти, ні перекинути між локаціями.
    it('drops non-stock-managed items, reports them, and refuses when none is left', async () => {
      const tracked = { productId: 'prod-1', productName: 'Deadbolt', quantity: 2 };
      const untracked = { productId: 'prod-2', productName: 'Shop rag', quantity: 1 };
      productsService.partitionStockManaged.mockImplementation(async (list: { productId: string }[]) => ({
        managed: list.filter((i) => i.productId !== 'prod-2'),
        unmanaged: list.filter((i) => i.productId === 'prod-2'),
      }));

      const result = await service.createTransfer(
        createMockCreateTransferDto({ items: [tracked, untracked] }),
        createMockJwtUser(),
      );

      expect(stockService.transfer).toHaveBeenCalledWith('WAREHOUSE#wh-1', 'CONTAINER#container-1', [tracked]);
      expect(result.items).toEqual([tracked]);
      expect(result.skippedItems).toEqual([untracked]);
      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ skippedItems: [untracked] }));

      await expect(
        service.createTransfer(createMockCreateTransferDto({ items: [untracked] }), createMockJwtUser()),
      ).rejects.toThrow(BadRequestException);
      expect(stockService.transfer).toHaveBeenCalledTimes(1);
    });

    it('carries no skippedItems when every item moved', async () => {
      const result = await service.createTransfer(createMockCreateTransferDto(), createMockJwtUser());

      expect(result).not.toHaveProperty('skippedItems');
    });

    /**
     * Назва товару в журналі, у рядку стоку й у переказі — з каталогу, не з
     * тіла запиту: інакше `productName: 'anything'` потрапляє в searchText і
     * пошук за справжньою назвою цей рядок губить.
     */
    it('names items as the catalog does, keeping the body name only for ids the catalog lacks', async () => {
      const dto = createMockCreateTransferDto({
        items: [
          { productId: 'prod-1', productName: 'anything', quantity: 2 },
          { productId: 'ghost', productName: 'Ghost part', quantity: 1 },
        ],
      });
      productsService.loadForStock.mockImplementation(async (id: string) =>
        id === 'prod-1' ? createMockProduct({ id, name: 'Kwikset Deadbolt', sku: 'SKU-001' }) : null,
      );

      const result = await service.createTransfer(dto, createMockJwtUser());

      const named = [
        { productId: 'prod-1', productName: 'Kwikset Deadbolt', quantity: 2 },
        { productId: 'ghost', productName: 'Ghost part', quantity: 1 },
      ];
      expect(stockService.transfer).toHaveBeenCalledWith('WAREHOUSE#wh-1', 'CONTAINER#container-1', named);
      expect(result.items).toEqual(named);
      expect(inventoryLog.record).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ productId: 'prod-1', productName: 'Kwikset Deadbolt', sku: 'SKU-001' }),
      );
      expect(inventoryLog.record).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ productId: 'ghost', productName: 'Ghost part' }),
      );
    });

    it('rejects transferring a service-type product and never touches stock', async () => {
      const dto = createMockCreateTransferDto();
      const user = createMockJwtUser();
      productsService.assertStockable.mockRejectedValueOnce(
        new BadRequestException('Services cannot be stocked or transferred: Rekey'),
      );

      await expect(service.createTransfer(dto, user)).rejects.toThrow(
        BadRequestException,
      );
      expect(productsService.assertStockable).toHaveBeenCalledWith(['prod-1']);
      expect(stockService.transfer).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('deductStock', () => {
    it('should call StockService.deduct and create DEDUCT transfer', async () => {
      const dto = {
        containerId: 'container-1',
        items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 3 }],
        dealId: 'deal-1',
        performedBy: 'tech-1',
        performedByName: 'tech@test.com',
      };
      stockService.deduct.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      await service.deductStock(dto as any);

      expect(stockService.deduct).toHaveBeenCalledWith('CONTAINER#container-1', dto.items);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransferType.DEDUCT,
          fromType: LocationType.CONTAINER,
          fromId: 'container-1',
          toType: null,
          toId: null,
          notes: 'Deal: deal-1',
        }),
      );
    });

    it('rejects deducting a service-type product before touching stock', async () => {
      const dto = {
        containerId: 'container-1',
        items: [{ productId: 'svc-1', productName: 'Rekey', quantity: 1 }],
        dealId: 'deal-1',
        performedBy: 'tech-1',
        performedByName: 'tech@test.com',
      };
      productsService.assertStockable.mockRejectedValueOnce(
        new BadRequestException('Services cannot be stocked or transferred: Rekey'),
      );

      await expect(service.deductStock(dto as any)).rejects.toThrow(BadRequestException);
      expect(productsService.assertStockable).toHaveBeenCalledWith(['svc-1']);
      expect(stockService.deduct).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('404s a deduct from a container that does not exist instead of touching a phantom row', async () => {
      locationsRepository.findLocation.mockResolvedValue(null);

      await expect(
        service.deductStock({
          containerId: 'tech-user-1',
          items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 1 }],
          dealId: 'deal-1',
          performedBy: 'tech-user-1',
          performedByName: 'tech@test.com',
        } as any),
      ).rejects.toThrow(NotFoundException);
      expect(stockService.deduct).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should resolve a technician id to the container they are assigned to before deducting', async () => {
      // The deal service passes the technician's user id; stock lives under the
      // container's own id — whichever van the user containers assign them.
      assignments.containerIdForUser.mockResolvedValue('container-xyz');
      const dto = {
        containerId: 'tech-user-1',
        items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 2 }],
        dealId: 'deal-1',
        performedBy: 'tech-user-1',
        performedByName: 'tech@test.com',
      };
      stockService.deduct.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      await service.deductStock(dto as any);

      expect(assignments.containerIdForUser).toHaveBeenCalledWith('tech-user-1');
      expect(stockService.deduct).toHaveBeenCalledWith('CONTAINER#container-xyz', dto.items);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ fromId: 'container-xyz' }),
      );
    });
  });

  /**
   * Списання на роботу — те, що звіт "Inventory usage" сумує: робота, хто,
   * звідки, і ціна з собівартістю на момент списання.
   */
  describe('deductStock — journal and audit log', () => {
    const dto = {
      containerId: 'container-1',
      items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 3 }],
      dealId: 'deal-1',
      performedBy: 'tech-1',
      performedByName: 'tech@test.com',
    };

    it('stamps the deal on the transfer and records stock_used with price and cost', async () => {
      productsService.loadForStock.mockResolvedValue(
        createMockProduct({ sku: 'SKU-001', priceClient: 25, costCompany: 10 }),
      );
      locationsRepository.findLocation.mockResolvedValue(createMockLocationSummary({ name: "Taras's van" }));

      await service.deductStock(dto as any);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: TransferType.DEDUCT, dealId: 'deal-1', notes: 'Deal: deal-1' }),
      );
      expect(inventoryLog.record).toHaveBeenCalledWith({
        action: InventoryLogAction.STOCK_USED,
        productId: 'prod-1',
        productName: 'Test Product',
        sku: 'SKU-001',
        quantity: 3,
        fromType: LocationType.CONTAINER,
        fromId: 'container-1',
        fromName: "Taras's van",
        dealId: 'deal-1',
        userId: 'tech-1',
        userName: 'tech@test.com',
        unitPrice: 25,
        unitCost: 10,
        category: 'Locks',
      });
    });

    // Вкладки Returns і Action log фільтрують за категорією й брендом —
    // знімок товару, уже прочитаного для перевірок складу.
    it('snapshots the category, brand and product number on the entry', async () => {
      productsService.loadForStock.mockResolvedValue(
        createMockProduct({ category: 'Keys', brandId: 'brand-9', number: 4242 }),
      );

      await service.deductStock(dto as any);

      expect(inventoryLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Keys', brandId: 'brand-9', number: 4242 }),
      );
    });

    it('leaves price and cost off when the product is unknown here', async () => {
      productsService.loadForStock.mockResolvedValue(null);

      await service.deductStock(dto as any);

      const entry = inventoryLog.record.mock.calls[0][0];
      expect(entry.action).toBe(InventoryLogAction.STOCK_USED);
      expect(entry).not.toHaveProperty('unitPrice');
      expect(entry).not.toHaveProperty('unitCost');
    });
  });

  describe('restoreStock', () => {
    it('stamps the deal on the transfer and records stock_restored into the container', async () => {
      const dto = {
        containerId: 'container-1',
        items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 3 }],
        dealId: 'deal-1',
        performedBy: 'tech-1',
        performedByName: 'tech@test.com',
      };
      productsService.loadForStock.mockResolvedValue(createMockProduct({ priceClient: 25, costCompany: 10 }));
      locationsRepository.findLocation.mockResolvedValue(createMockLocationSummary({ name: "Taras's van" }));

      await service.restoreStock(dto as any);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: TransferType.RESTORE, dealId: 'deal-1', notes: 'Deal: deal-1' }),
      );
      expect(inventoryLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: InventoryLogAction.STOCK_RESTORED,
          productId: 'prod-1',
          quantity: 3,
          toType: LocationType.CONTAINER,
          toId: 'container-1',
          toName: "Taras's van",
          dealId: 'deal-1',
          userId: 'tech-1',
          userName: 'tech@test.com',
          unitPrice: 25,
          unitCost: 10,
        }),
      );
    });

    /**
     * deal-service шле на повернення знову id техніка. Якщо між списанням і
     * поверненням його перепризначили (фургон B) чи дали "All locations",
     * одиниці мають повернутись туди, звідки їх списали (фургон A), а не в
     * B чи у фантомний CONTAINER#<techId>.
     */
    it('restores into the van the units were used from, whatever the technician holds now', async () => {
      inventoryLog.lastStockUse.mockResolvedValue({ fromId: 'van-A' });
      assignments.containerIdForUser.mockResolvedValue('van-B');

      await service.restoreStock({
        containerId: 'tech-user-1',
        items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 2 }],
        dealId: 'deal-1',
        performedBy: 'tech-user-1',
        performedByName: 'tech@test.com',
      } as any);

      expect(inventoryLog.lastStockUse).toHaveBeenCalledWith('prod-1', 'deal-1');
      expect(stockService.receive).toHaveBeenCalledWith('CONTAINER#van-A', expect.any(Array));
      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ toId: 'van-A' }));
    });

    it('splits a restore whose lines were used from two vans, one RESTORE per van', async () => {
      inventoryLog.lastStockUse.mockImplementation(async (productId: string) =>
        productId === 'prod-1' ? { fromId: 'van-A' } : { fromId: 'van-B' },
      );

      await service.restoreStock({
        containerId: 'tech-user-1',
        items: [
          { productId: 'prod-1', productName: 'Lock', quantity: 1 },
          { productId: 'prod-2', productName: 'Hinge', quantity: 2 },
        ],
        dealId: 'deal-1',
        performedBy: 'tech-user-1',
        performedByName: 'tech@test.com',
      } as any);

      expect(stockService.receive.mock.calls).toEqual([
        ['CONTAINER#van-A', [expect.objectContaining({ productId: 'prod-1' })]],
        ['CONTAINER#van-B', [expect.objectContaining({ productId: 'prod-2' })]],
      ]);
      expect(repository.create).toHaveBeenCalledTimes(2);
    });

    /**
     * deal-service чекає на повернення й пропускає помилку далі: 404 блокував би
     * диспетчеру видалення рядка роботи. Рядок, для якого наявного фургона не
     * знайти (списано до журналу, технік тепер на "All locations"), пропускається
     * й лягає в журнал як stock_restore_skipped; решта повертається як зазвичай.
     */
    it('skips a line with no existing container to go to, logs it, and answers it — no 404, no phantom row', async () => {
      // "All locations": the resolver names no van, so the technician id would be taken as a container id.
      locationsRepository.findLocation.mockResolvedValue(null);
      const line = { productId: 'prod-1', productName: 'Test Product', quantity: 1 };

      const result = await service.restoreStock({
        containerId: 'tech-user-1',
        items: [line],
        dealId: 'deal-1',
        performedBy: 'tech-user-1',
        performedByName: 'tech@test.com',
      } as any);

      expect(result).toEqual({ skippedItems: [line] });
      expect(locationsRepository.findLocation).toHaveBeenCalledWith(LocationType.CONTAINER, 'tech-user-1');
      expect(stockService.receive).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(inventoryLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: InventoryLogAction.STOCK_RESTORE_SKIPPED,
          productId: 'prod-1',
          quantity: 1,
          dealId: 'deal-1',
          userId: 'tech-user-1',
          userName: 'tech@test.com',
        }),
      );
      expect(inventoryLog.record.mock.calls[0][0]).not.toHaveProperty('toId');
    });

    it('restores the lines it can place and skips only the rest', async () => {
      inventoryLog.lastStockUse.mockImplementation(async (productId: string) =>
        productId === 'prod-1' ? { fromId: 'van-A' } : null,
      );
      locationsRepository.findLocation.mockImplementation(async (_type: LocationType, id: string) =>
        id === 'van-A' ? createMockLocationSummary({ id, name: 'Van A' }) : null,
      );

      const result = await service.restoreStock({
        containerId: 'tech-user-1',
        items: [
          { productId: 'prod-1', productName: 'Lock', quantity: 1 },
          { productId: 'prod-2', productName: 'Hinge', quantity: 2 },
        ],
        dealId: 'deal-1',
        performedBy: 'tech-user-1',
        performedByName: 'tech@test.com',
      } as any);

      expect(stockService.receive).toHaveBeenCalledWith('CONTAINER#van-A', [expect.objectContaining({ productId: 'prod-1' })]);
      expect(result.skippedItems.map((i) => i.productId)).toEqual(['prod-2']);
    });

    it('falls back to the technician’s van when the van the log names no longer exists', async () => {
      inventoryLog.lastStockUse.mockResolvedValue({ fromId: 'van-gone' });
      assignments.containerIdForUser.mockResolvedValue('van-B');
      locationsRepository.findLocation.mockImplementation(async (_type: LocationType, id: string) =>
        id === 'van-B' ? createMockLocationSummary({ id }) : null,
      );

      const result = await service.restoreStock({
        containerId: 'tech-user-1',
        items: [{ productId: 'prod-1', productName: 'Lock', quantity: 1 }],
        dealId: 'deal-1',
        performedBy: 'tech-user-1',
        performedByName: 'tech@test.com',
      } as any);

      expect(stockService.receive).toHaveBeenCalledWith('CONTAINER#van-B', expect.any(Array));
      expect(result.skippedItems).toEqual([]);
    });

    it('restores into the container the technician is assigned to', async () => {
      assignments.containerIdForUser.mockResolvedValue('container-xyz');

      await service.restoreStock({
        containerId: 'tech-user-1',
        items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 1 }],
        dealId: 'deal-1',
        performedBy: 'tech-user-1',
        performedByName: 'tech@test.com',
      } as any);

      expect(assignments.containerIdForUser).toHaveBeenCalledWith('tech-user-1');
      expect(stockService.receive).toHaveBeenCalledWith('CONTAINER#container-xyz', expect.any(Array));
    });

    it('keeps an id that names no user with a container as a container id', async () => {
      await service.restoreStock({
        containerId: 'container-1',
        items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 1 }],
        dealId: 'deal-1',
        performedBy: 'tech-1',
        performedByName: 'tech@test.com',
      } as any);

      expect(stockService.receive).toHaveBeenCalledWith('CONTAINER#container-1', expect.any(Array));
    });

    it('should call StockService.receive and create RESTORE transfer', async () => {
      const dto = {
        containerId: 'container-1',
        items: [{ productId: 'prod-1', productName: 'Test Product', quantity: 3 }],
        dealId: 'deal-1',
        performedBy: 'tech-1',
        performedByName: 'tech@test.com',
      };
      stockService.receive.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);

      await service.restoreStock(dto as any);

      expect(stockService.receive).toHaveBeenCalledWith('CONTAINER#container-1', dto.items);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransferType.RESTORE,
          fromType: null,
          fromId: null,
          toType: LocationType.CONTAINER,
          toId: 'container-1',
          notes: 'Deal: deal-1',
        }),
      );
    });
  });

  /**
   * 6 643 imported product-type items have Workiz `manage = 0`: the price book
   * carries them but no stock counter exists, so a deduction would 400 with
   * "Insufficient stock" and a restore would invent stock nobody counted.
   */
  describe('non-stock-managed items (manageStock: false)', () => {
    const tracked = { productId: 'prod-1', productName: 'Deadbolt', quantity: 3 };
    const untracked = { productId: 'prod-2', productName: 'Shop rag', quantity: 1 };
    const dto = (items: unknown[]) => ({
      containerId: 'container-1',
      items,
      dealId: 'deal-1',
      performedBy: 'tech-1',
      performedByName: 'tech@test.com',
    });

    beforeEach(() => {
      stockService.deduct.mockResolvedValue(undefined);
      stockService.receive.mockResolvedValue(undefined);
      repository.create.mockResolvedValue(undefined);
      productsService.partitionStockManaged.mockImplementation(
        async (items: { productId: string }[]) => ({
          managed: items.filter((i) => i.productId !== 'prod-2'),
          unmanaged: items.filter((i) => i.productId === 'prod-2'),
        }),
      );
    });

    it('never deducts one, and keeps it out of the transfer journal', async () => {
      await service.deductStock(dto([tracked, untracked]) as any);

      expect(stockService.deduct).toHaveBeenCalledWith('CONTAINER#container-1', [tracked]);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: TransferType.DEDUCT, items: [tracked] }),
      );
    });

    it('never restores one either — what was not deducted does not come back', async () => {
      await service.restoreStock(dto([tracked, untracked]) as any);

      expect(stockService.receive).toHaveBeenCalledWith('CONTAINER#container-1', [tracked]);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: TransferType.RESTORE, items: [tracked] }),
      );
    });

    it('does nothing at all when every item is untracked', async () => {
      await service.deductStock(dto([untracked]) as any);

      expect(stockService.deduct).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('still rejects a service line before looking at manageStock', async () => {
      productsService.assertStockable.mockRejectedValueOnce(
        new BadRequestException('Services cannot be stocked or transferred: Rekey'),
      );

      await expect(service.deductStock(dto([untracked]) as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(productsService.partitionStockManaged).not.toHaveBeenCalled();
    });
  });

  /**
   * "Add to stock" на рядку товару у Workiz: отримати від постачальника в
   * будь-яку локацію — склад або фургон. Один шлях і для POST /warehouses/:id/receive.
   */
  describe('receiveStock', () => {
    const items = [{ productId: 'prod-1', productName: 'Deadbolt', quantity: 5 }];
    const user = createMockJwtUser();

    beforeEach(() => {
      locationsRepository.findLocation.mockResolvedValue(
        createMockLocationSummary({ type: 'warehouse', id: 'wh-1', name: 'Main Warehouse' }),
      );
    });

    it('404s on a location that does not exist and touches nothing', async () => {
      locationsRepository.findLocation.mockResolvedValue(null);

      await expect(
        service.receiveStock({ toType: LocationType.WAREHOUSE, toId: 'ghost', items }, user),
      ).rejects.toThrow(NotFoundException);
      expect(locationsRepository.findLocation).toHaveBeenCalledWith(LocationType.WAREHOUSE, 'ghost');
      expect(stockService.receive).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses to receive into an archived location and touches nothing', async () => {
      locationsRepository.findLocation.mockResolvedValue(
        createMockLocationSummary({ type: 'warehouse', id: 'wh-1', name: '(2) OLD STORE', status: InventoryStatus.ARCHIVED }),
      );

      await expect(
        service.receiveStock({ toType: LocationType.WAREHOUSE, toId: 'wh-1', items }, user),
      ).rejects.toThrow(new BadRequestException('Warehouse "(2) OLD STORE" is archived'));
      expect(stockService.receive).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('receives into a warehouse and journals a RECEIVE from the supplier', async () => {
      const result = await service.receiveStock(
        { toType: LocationType.WAREHOUSE, toId: 'wh-1', items, notes: 'PO 12' },
        user,
      );

      expect(productsService.assertStockable).toHaveBeenCalledWith(['prod-1']);
      expect(stockService.receive).toHaveBeenCalledWith('WAREHOUSE#wh-1', items);
      expect(result).toMatchObject({
        type: TransferType.RECEIVE,
        fromType: LocationType.SUPPLIER,
        fromId: null,
        toType: LocationType.WAREHOUSE,
        toId: 'wh-1',
        items,
        notes: 'PO 12',
        performedBy: user.id,
        performedByName: user.email,
      });
      expect(result.id).toBeDefined();
      expect(repository.create).toHaveBeenCalledWith(result);
      expect(publisher.publish).toHaveBeenCalledWith('inventory-events', 'transfer.created', {
        transferId: result.id,
      });
    });

    it('receives into a container', async () => {
      locationsRepository.findLocation.mockResolvedValue(createMockLocationSummary());

      const result = await service.receiveStock({ toType: LocationType.CONTAINER, toId: 'container-1', items }, user);

      expect(stockService.receive).toHaveBeenCalledWith('CONTAINER#container-1', items);
      expect(result).toMatchObject({ toType: LocationType.CONTAINER, toId: 'container-1' });
    });

    it('records stock_received per item with the location name', async () => {
      productsService.loadForStock.mockImplementation(async (id: string) =>
        createMockProduct({ id, name: id === 'prod-1' ? 'Deadbolt' : 'Knob', sku: 'SKU-001' }),
      );
      const two = [...items, { productId: 'prod-2', productName: 'Knob', quantity: 1 }];

      await service.receiveStock({ toType: LocationType.WAREHOUSE, toId: 'wh-1', items: two }, user);

      expect(inventoryLog.record).toHaveBeenCalledTimes(2);
      expect(inventoryLog.record).toHaveBeenNthCalledWith(1, {
        action: InventoryLogAction.STOCK_RECEIVED,
        productId: 'prod-1',
        productName: 'Deadbolt',
        sku: 'SKU-001',
        quantity: 5,
        toType: LocationType.WAREHOUSE,
        toId: 'wh-1',
        toName: 'Main Warehouse',
        userId: user.id,
        userName: user.email,
        category: 'Locks',
      });
    });

    it('rejects a service-type product before touching stock', async () => {
      productsService.assertStockable.mockRejectedValueOnce(
        new BadRequestException('Services cannot be stocked or transferred: Rekey'),
      );

      await expect(
        service.receiveStock({ toType: LocationType.WAREHOUSE, toId: 'wh-1', items }, user),
      ).rejects.toThrow(BadRequestException);
      expect(stockService.receive).not.toHaveBeenCalled();
    });

    it('drops non-stock-managed items, and refuses when none is left', async () => {
      const untracked = { productId: 'prod-2', productName: 'Shop rag', quantity: 1 };
      productsService.partitionStockManaged.mockImplementation(async (list: { productId: string }[]) => ({
        managed: list.filter((i) => i.productId !== 'prod-2'),
        unmanaged: list.filter((i) => i.productId === 'prod-2'),
      }));

      const result = await service.receiveStock(
        { toType: LocationType.WAREHOUSE, toId: 'wh-1', items: [...items, untracked] },
        user,
      );
      expect(stockService.receive).toHaveBeenCalledWith('WAREHOUSE#wh-1', items);
      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ items, skippedItems: [untracked] }));
      // The caller sees what did not move, so the dialog can say so.
      expect(result.skippedItems).toEqual([untracked]);

      await expect(
        service.receiveStock({ toType: LocationType.WAREHOUSE, toId: 'wh-1', items: [untracked] }, user),
      ).rejects.toThrow(BadRequestException);
      expect(stockService.receive).toHaveBeenCalledTimes(1);
    });

    it('carries no skippedItems when every item was received', async () => {
      const result = await service.receiveStock({ toType: LocationType.WAREHOUSE, toId: 'wh-1', items }, user);

      expect(result).not.toHaveProperty('skippedItems');
    });

    it('stores and logs the catalog name, not the one the body sent', async () => {
      productsService.loadForStock.mockResolvedValue(
        createMockProduct({ id: 'prod-1', name: 'Kwikset Deadbolt', sku: 'SKU-001' }),
      );

      const result = await service.receiveStock(
        { toType: LocationType.WAREHOUSE, toId: 'wh-1', items: [{ productId: 'prod-1', productName: 'anything', quantity: 5 }] },
        user,
      );

      const named = [{ productId: 'prod-1', productName: 'Kwikset Deadbolt', quantity: 5 }];
      expect(stockService.receive).toHaveBeenCalledWith('WAREHOUSE#wh-1', named);
      expect(result.items).toEqual(named);
      expect(inventoryLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ productName: 'Kwikset Deadbolt', sku: 'SKU-001' }),
      );
    });
  });

  /** "Return" на рядку товару у Workiz: товар іде з локації без роботи, з причиною. */
  describe('returnStock', () => {
    const items = [{ productId: 'prod-1', productName: 'Deadbolt', quantity: 2 }];
    const user = createMockJwtUser();

    beforeEach(() => {
      locationsRepository.findLocation.mockResolvedValue(createMockLocationSummary({ name: "Taras's van" }));
    });

    it('still returns stock out of an archived location', async () => {
      locationsRepository.findLocation.mockResolvedValue(
        createMockLocationSummary({ status: InventoryStatus.ARCHIVED }),
      );

      await expect(
        service.returnStock(
          { fromType: LocationType.CONTAINER, fromId: 'container-1', items, reason: ReturnReason.DAMAGED },
          user,
        ),
      ).resolves.toBeDefined();
      expect(stockService.deduct).toHaveBeenCalled();
    });

    it('404s on a location that does not exist', async () => {
      locationsRepository.findLocation.mockResolvedValue(null);

      await expect(
        service.returnStock(
          { fromType: LocationType.CONTAINER, fromId: 'ghost', items, reason: ReturnReason.LOST },
          user,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(stockService.deduct).not.toHaveBeenCalled();
    });

    it('deducts from the location and journals a RETURN with its reason', async () => {
      const result = await service.returnStock(
        { fromType: LocationType.CONTAINER, fromId: 'container-1', items, reason: ReturnReason.DAMAGED, notes: 'bent' },
        user,
      );

      expect(stockService.deduct).toHaveBeenCalledWith('CONTAINER#container-1', items);
      expect(result).toMatchObject({
        type: TransferType.RETURN,
        fromType: LocationType.CONTAINER,
        fromId: 'container-1',
        toType: null,
        toId: null,
        items,
        reason: ReturnReason.DAMAGED,
        notes: 'bent',
        performedBy: user.id,
        performedByName: user.email,
      });
      expect(repository.create).toHaveBeenCalledWith(result);
      expect(publisher.publish).toHaveBeenCalledWith('inventory-events', 'transfer.created', {
        transferId: result.id,
      });
    });

    it('records stock_returned per item with the reason and the source name', async () => {
      await service.returnStock(
        { fromType: LocationType.CONTAINER, fromId: 'container-1', items, reason: ReturnReason.RECALL },
        user,
      );

      expect(inventoryLog.record).toHaveBeenCalledWith({
        action: InventoryLogAction.STOCK_RETURNED,
        productId: 'prod-1',
        productName: 'Deadbolt',
        quantity: 2,
        fromType: LocationType.CONTAINER,
        fromId: 'container-1',
        fromName: "Taras's van",
        reason: ReturnReason.RECALL,
        userId: user.id,
        userName: user.email,
      });
    });

    it('snapshots the returned item\'s category and brand for the Returns filters', async () => {
      productsService.loadForStock.mockResolvedValue(
        createMockProduct({ name: 'Deadbolt', category: 'Locks', brandId: 'brand-1', number: 17 }),
      );

      await service.returnStock(
        { fromType: LocationType.CONTAINER, fromId: 'container-1', items, reason: ReturnReason.RECALL },
        user,
      );

      expect(inventoryLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: InventoryLogAction.STOCK_RETURNED,
          category: 'Locks',
          brandId: 'brand-1',
          number: 17,
        }),
      );
    });

    it('propagates insufficient stock and writes no transfer', async () => {
      stockService.deduct.mockRejectedValueOnce(new BadRequestException('Insufficient stock'));

      await expect(
        service.returnStock(
          { fromType: LocationType.WAREHOUSE, fromId: 'wh-1', items, reason: ReturnReason.OTHER },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
      expect(inventoryLog.record).not.toHaveBeenCalled();
    });

    it('drops non-stock-managed items and reports them, naming the rest as the catalog does', async () => {
      const untracked = { productId: 'prod-2', productName: 'Shop rag', quantity: 1 };
      productsService.partitionStockManaged.mockImplementation(async (list: { productId: string }[]) => ({
        managed: list.filter((i) => i.productId !== 'prod-2'),
        unmanaged: list.filter((i) => i.productId === 'prod-2'),
      }));
      productsService.loadForStock.mockImplementation(async (id: string) =>
        id === 'prod-1' ? createMockProduct({ id, name: 'Kwikset Deadbolt' }) : null,
      );

      const result = await service.returnStock(
        { fromType: LocationType.CONTAINER, fromId: 'container-1', items: [...items, untracked], reason: ReturnReason.LOST },
        user,
      );

      const named = [{ productId: 'prod-1', productName: 'Kwikset Deadbolt', quantity: 2 }];
      expect(stockService.deduct).toHaveBeenCalledWith('CONTAINER#container-1', named);
      expect(result.items).toEqual(named);
      expect(result.skippedItems).toEqual([untracked]);
      expect(inventoryLog.record).toHaveBeenCalledTimes(1);
      expect(inventoryLog.record).toHaveBeenCalledWith(expect.objectContaining({ productName: 'Kwikset Deadbolt' }));
    });
  });

  describe('findById', () => {
    it('should delegate to repository', async () => {
      const transfer = createMockTransfer();
      repository.findById.mockResolvedValue(transfer);

      const result = await service.findById('transfer-1');

      expect(result).toEqual(transfer);
      expect(repository.findById).toHaveBeenCalledWith('transfer-1');
    });
  });

  describe('findByEntity', () => {
    it('should delegate to repository', async () => {
      const paginated = { items: [createMockTransfer()], nextCursor: undefined };
      repository.findByEntity.mockResolvedValue(paginated);

      const result = await service.findByEntity('warehouse', 'wh-1', 20);

      expect(result).toEqual(paginated);
      expect(repository.findByEntity).toHaveBeenCalledWith('warehouse', 'wh-1', 20, undefined);
    });
  });

  describe('list', () => {
    it('should delegate to repository with default limit', async () => {
      const paginated = { items: [createMockTransfer()], nextCursor: undefined };
      repository.findAll.mockResolvedValue(paginated);

      const result = await service.list({} as any);

      expect(result).toEqual(paginated);
      expect(repository.findAll).toHaveBeenCalledWith(20, undefined, { type: undefined });
    });

    it('should use provided limit and cursor', async () => {
      repository.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await service.list({ limit: 50, cursor: 'abc' } as any);

      expect(repository.findAll).toHaveBeenCalledWith(50, 'abc', { type: undefined });
    });

    it('passes the type filter to the repository', async () => {
      repository.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await service.list({ limit: 20, type: TransferType.RETURN } as any);

      expect(repository.findAll).toHaveBeenCalledWith(20, undefined, { type: TransferType.RETURN });
    });
  });

  describe('count', () => {
    it('answers how many transfers the list holds', async () => {
      repository.countAll.mockResolvedValue({ total: 18, atLeast: false });

      expect(await service.count()).toEqual({ total: 18, atLeast: false });
    });

    it('carries the floor flag through', async () => {
      repository.countAll.mockResolvedValue({ total: 10_000, atLeast: true });

      expect(await service.count()).toEqual({ total: 10_000, atLeast: true });
    });

    it('answers a repeat from the cache rather than re-walking the table', async () => {
      repository.countAll.mockResolvedValue({ total: 18, atLeast: false });

      await service.count();
      await service.count();

      expect(repository.countAll).toHaveBeenCalledTimes(1);
    });

    it('counts under the type filter, cached per type', async () => {
      repository.countAll.mockResolvedValue({ total: 3, atLeast: false });

      await service.count({ type: TransferType.RECEIVE } as any);
      await service.count({ type: TransferType.RETURN } as any);
      await service.count({ type: TransferType.RECEIVE } as any);

      expect(repository.countAll.mock.calls).toEqual([
        [{ type: TransferType.RECEIVE }],
        [{ type: TransferType.RETURN }],
      ]);
    });
  });
});

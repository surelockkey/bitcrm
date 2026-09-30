import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataScope, InventoryStatus, LocationType, ProductType } from '@bitcrm/types';
import { ContainerTemplatesService } from 'src/container-templates/container-templates.service';
import {
  createMockContainerTemplate,
  createMockContainerTemplatesRepository,
  createMockJwtUser,
  createMockLocationSummary,
  createMockLocationsRepository,
  createMockProduct,
  createMockProductsService,
  createMockStockRepository,
  createMockTransfer,
  createMockTransfersService,
  createMockContainerAssignmentResolver,
  createMockResolvedPermissions,
} from '../mocks';

/**
 * Шаблон — "ідеальне завантаження" фургона: створюється раз, потім будь-який
 * фургон порівнюється з ним (ціль / є / бракує), а "Fill from warehouse"
 * одним переміщенням довозить зі складу те, чого бракує.
 */
describe('ContainerTemplatesService', () => {
  let repository: ReturnType<typeof createMockContainerTemplatesRepository>;
  let products: ReturnType<typeof createMockProductsService>;
  let locations: ReturnType<typeof createMockLocationsRepository>;
  let stock: ReturnType<typeof createMockStockRepository>;
  let transfers: ReturnType<typeof createMockTransfersService>;
  let assignments: ReturnType<typeof createMockContainerAssignmentResolver>;
  let service: ContainerTemplatesService;

  const user = createMockJwtUser();

  const catalog: Record<string, ReturnType<typeof createMockProduct>> = {
    'prod-1': createMockProduct({ id: 'prod-1', name: 'Deadbolt', sku: 'SKU-001' }),
    'prod-2': createMockProduct({ id: 'prod-2', name: 'Rekey kit', sku: 'SKU-002' }),
    'svc-1': createMockProduct({ id: 'svc-1', name: 'Rekey', sku: 'SVC-1', type: ProductType.SERVICE }),
    'free-1': createMockProduct({ id: 'free-1', name: 'Screws', sku: 'FREE-1', manageStock: false }),
  };

  beforeEach(() => {
    repository = createMockContainerTemplatesRepository();
    products = createMockProductsService();
    products.loadForStock.mockImplementation(async (id: string) => catalog[id] ?? null);
    locations = createMockLocationsRepository();
    locations.findLocation.mockImplementation(async (type: LocationType, id: string) =>
      createMockLocationSummary({
        type: type === LocationType.WAREHOUSE ? 'warehouse' : 'container',
        id,
        name: type === LocationType.WAREHOUSE ? '(1) STORE' : '(12) MIKE',
      }),
    );
    stock = createMockStockRepository();
    transfers = createMockTransfersService();
    assignments = createMockContainerAssignmentResolver();
    service = new ContainerTemplatesService(
      repository as any,
      products as any,
      locations as any,
      stock as any,
      transfers as any,
      assignments as any,
    );
  });

  describe('reads', () => {
    const active = createMockContainerTemplate({ id: 'a' });
    const archived = createMockContainerTemplate({ id: 'b', status: InventoryStatus.ARCHIVED });

    it('lists the active templates by default', async () => {
      repository.listAll.mockResolvedValue([active, archived]);

      expect(await service.list()).toEqual([active]);
    });

    it('lists the archived ones on request', async () => {
      repository.listAll.mockResolvedValue([active, archived]);

      expect(await service.list(InventoryStatus.ARCHIVED)).toEqual([archived]);
    });

    it('404s on an unknown template', async () => {
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('stores the lines with the catalog’s names and SKUs, active', async () => {
      const template = await service.create({
        name: '  Standard van ',
        description: 'Every van',
        items: [
          { productId: 'prod-2', quantity: 2 },
          { productId: 'prod-1', quantity: 5 },
        ],
      });

      expect(template).toEqual({
        id: expect.any(String),
        name: 'Standard van',
        description: 'Every van',
        items: [
          { productId: 'prod-2', productName: 'Rekey kit', sku: 'SKU-002', quantity: 2 },
          { productId: 'prod-1', productName: 'Deadbolt', sku: 'SKU-001', quantity: 5 },
        ],
        status: InventoryStatus.ACTIVE,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(repository.create).toHaveBeenCalledWith(template);
      expect(repository.findByName).toHaveBeenCalledWith('Standard van');
    });

    it('refuses the same product twice', async () => {
      await expect(
        service.create({
          name: 'Van',
          items: [
            { productId: 'prod-1', quantity: 1 },
            { productId: 'prod-1', quantity: 2 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses a product the catalog does not hold', async () => {
      await expect(
        service.create({ name: 'Van', items: [{ productId: 'ghost', quantity: 1 }] }),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['a service', 'svc-1'],
      ['an item whose stock is not managed', 'free-1'],
    ])('refuses %s', async (_label, productId) => {
      await expect(service.create({ name: 'Van', items: [{ productId, quantity: 1 }] })).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses a name an active template already has, in any case', async () => {
      repository.findByName.mockResolvedValue([createMockContainerTemplate({ id: 'other', name: 'STANDARD VAN' })]);

      await expect(
        service.create({ name: 'standard van', items: [{ productId: 'prod-1', quantity: 1 }] }),
      ).rejects.toThrow(ConflictException);
    });

    it('takes a name only an archived template has', async () => {
      repository.findByName.mockResolvedValue([
        createMockContainerTemplate({ id: 'old', status: InventoryStatus.ARCHIVED }),
      ]);

      await expect(
        service.create({ name: 'Standard van', items: [{ productId: 'prod-1', quantity: 1 }] }),
      ).resolves.toBeDefined();
    });
  });

  describe('update', () => {
    const existing = createMockContainerTemplate();

    beforeEach(() => {
      repository.findById.mockResolvedValue(existing);
    });

    it('renames, keeping the lines, and checks the name against the other templates only', async () => {
      repository.findByName.mockResolvedValue([existing]);

      const updated = await service.update('tpl-1', { name: 'Big van' });

      expect(updated).toEqual({ ...existing, name: 'Big van', updatedAt: expect.any(String) });
      expect(repository.put).toHaveBeenCalledWith(updated);
    });

    it('refuses a rename onto another active template’s name', async () => {
      repository.findByName.mockResolvedValue([createMockContainerTemplate({ id: 'other', name: 'Big van' })]);

      await expect(service.update('tpl-1', { name: 'big van' })).rejects.toThrow(ConflictException);
      expect(repository.put).not.toHaveBeenCalled();
    });

    it('replaces the lines under the same rules as a create', async () => {
      const updated = await service.update('tpl-1', { items: [{ productId: 'prod-2', quantity: 7 }] });

      expect(updated.items).toEqual([{ productId: 'prod-2', productName: 'Rekey kit', sku: 'SKU-002', quantity: 7 }]);
      await expect(service.update('tpl-1', { items: [{ productId: 'svc-1', quantity: 1 }] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('clears the description with null', async () => {
      const updated = await service.update('tpl-1', { description: null });

      expect(updated).not.toHaveProperty('description');
    });

    it('checks the name again when an archived template comes back', async () => {
      repository.findById.mockResolvedValue(createMockContainerTemplate({ status: InventoryStatus.ARCHIVED }));
      repository.findByName.mockResolvedValue([createMockContainerTemplate({ id: 'other' })]);

      await expect(service.update('tpl-1', { status: InventoryStatus.ACTIVE })).rejects.toThrow(ConflictException);
    });

    it('404s on an unknown template', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('archive', () => {
    it('archives rather than deletes — containers may still name the template', async () => {
      repository.findById.mockResolvedValue(createMockContainerTemplate());

      const archived = await service.archive('tpl-1');

      expect(archived.status).toBe(InventoryStatus.ARCHIVED);
      expect(repository.put).toHaveBeenCalledWith(archived);
    });
  });

  describe('diff', () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(createMockContainerTemplate());
    });

    it('answers target, on hand and missing per line, in template order', async () => {
      stock.getQuantities.mockResolvedValue(
        new Map([['CONTAINER#c-1', new Map([['prod-1', 2], ['prod-2', 3]])]]),
      );

      const diff = await service.diff('tpl-1', 'c-1');

      expect(stock.getQuantities).toHaveBeenCalledWith(['CONTAINER#c-1'], ['prod-1', 'prod-2']);
      expect(diff).toEqual({
        templateId: 'tpl-1',
        templateName: 'Standard van',
        containerId: 'c-1',
        containerName: '(12) MIKE',
        lines: [
          { productId: 'prod-1', productName: 'Deadbolt', sku: 'SKU-001', target: 5, onHand: 2, missing: 3 },
          // Overstocked: nothing missing, never negative.
          { productId: 'prod-2', productName: 'Rekey kit', sku: 'SKU-002', target: 2, onHand: 3, missing: 0 },
        ],
        shortLineCount: 1,
        missingUnits: 3,
      });
    });

    it('adds what the warehouse holds and what a fill would move', async () => {
      stock.getQuantities.mockResolvedValue(
        new Map([['WAREHOUSE#wh-1', new Map([['prod-1', 1], ['prod-2', 50]])]]),
      );

      const diff = await service.diff('tpl-1', 'c-1', 'wh-1');

      expect(stock.getQuantities).toHaveBeenCalledWith(
        ['CONTAINER#c-1', 'WAREHOUSE#wh-1'],
        ['prod-1', 'prod-2'],
      );
      expect(diff.warehouseId).toBe('wh-1');
      expect(diff.warehouseName).toBe('(1) STORE');
      expect(diff.lines.map((l) => [l.missing, l.available, l.willMove])).toEqual([
        [5, 1, 1],
        [2, 50, 2],
      ]);
      expect(diff.missingUnits).toBe(7);
      expect(diff.shortLineCount).toBe(2);
    });

    it('404s on an unknown template, container or warehouse', async () => {
      locations.findLocation.mockResolvedValue(null);
      await expect(service.diff('tpl-1', 'nope')).rejects.toThrow(NotFoundException);

      repository.findById.mockResolvedValue(null);
      await expect(service.diff('missing', 'c-1')).rejects.toThrow(NotFoundException);
    });

    it('404s on an unknown warehouse', async () => {
      locations.findLocation.mockImplementation(async (type: LocationType, id: string) =>
        type === LocationType.WAREHOUSE ? null : createMockLocationSummary({ id }),
      );

      await expect(service.diff('tpl-1', 'c-1', 'nope')).rejects.toThrow(NotFoundException);
      expect(stock.getQuantities).not.toHaveBeenCalled();
    });
  });

  /**
   * Порівняння й заповнення підкоряються тим самим правилам обсягу, що й сток
   * фургона: технік — лише свій фургон (або всі з "All locations"), склад —
   * лише з warehouses.view.
   */
  describe('data scope', () => {
    const technician = createMockResolvedPermissions({
      permissions: { containers: { view: true }, warehouses: { view: false }, transfers: { create: true } },
      dataScope: { containers: DataScope.ASSIGNED_ONLY },
    });
    const viewer = { user: createMockJwtUser({ id: 'tech-1' }), permissions: technician };

    beforeEach(() => {
      repository.findById.mockResolvedValue(createMockContainerTemplate());
    });

    it('lets a technician compare their own van', async () => {
      assignments.containerIdForUser.mockResolvedValue('c-1');

      await expect(service.diff('tpl-1', 'c-1', undefined, viewer)).resolves.toBeDefined();
    });

    it('403s a technician comparing another van, before reading stock', async () => {
      assignments.containerIdForUser.mockResolvedValue('c-other');

      await expect(service.diff('tpl-1', 'c-1', undefined, viewer)).rejects.toThrow(ForbiddenException);
      expect(stock.getQuantities).not.toHaveBeenCalled();
    });

    it('403s a comparison against a warehouse without warehouses.view', async () => {
      assignments.containerIdForUser.mockResolvedValue('c-1');

      await expect(service.diff('tpl-1', 'c-1', 'wh-1', viewer)).rejects.toThrow(ForbiddenException);
      expect(stock.getQuantities).not.toHaveBeenCalled();
    });

    it('lets "All locations" compare any van', async () => {
      assignments.assignmentFor.mockResolvedValue({ allLocations: true });

      await expect(service.diff('tpl-1', 'c-1', undefined, viewer)).resolves.toBeDefined();
    });

    it('403s filling a van outside the scope, moving nothing', async () => {
      assignments.containerIdForUser.mockResolvedValue('c-other');

      await expect(
        service.fill('tpl-1', { containerId: 'c-1', warehouseId: 'wh-1' } as any, user, technician),
      ).rejects.toThrow(ForbiddenException);
      expect(transfers.createTransfer).not.toHaveBeenCalled();
    });

    it('fills the caller’s own van from a warehouse (the container check only)', async () => {
      assignments.containerIdForUser.mockResolvedValue('c-1');

      await expect(
        service.fill('tpl-1', { containerId: 'c-1', warehouseId: 'wh-1' } as any, user, technician),
      ).resolves.toBeDefined();
    });
  });

  describe('fill', () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(
        createMockContainerTemplate({
          items: [
            { productId: 'prod-1', productName: 'Deadbolt', sku: 'SKU-001', quantity: 5 },
            { productId: 'prod-2', productName: 'Rekey kit', sku: 'SKU-002', quantity: 2 },
            { productId: 'prod-3', productName: 'Hinge', sku: 'SKU-003', quantity: 1 },
          ],
        }),
      );
      stock.getQuantities.mockResolvedValue(
        new Map([
          ['CONTAINER#c-1', new Map([['prod-3', 4]])],
          ['WAREHOUSE#wh-1', new Map([['prod-1', 3], ['prod-2', 10]])],
        ]),
      );
      transfers.createTransfer.mockImplementation(async (dto: any) =>
        createMockTransfer({ items: dto.items, notes: dto.notes }),
      );
    });

    it('moves what is missing and available in ONE warehouse → container transfer', async () => {
      const result = await service.fill('tpl-1', { containerId: 'c-1', warehouseId: 'wh-1' }, user);

      expect(transfers.createTransfer).toHaveBeenCalledTimes(1);
      expect(transfers.createTransfer).toHaveBeenCalledWith(
        {
          fromType: LocationType.WAREHOUSE,
          fromId: 'wh-1',
          toType: LocationType.CONTAINER,
          toId: 'c-1',
          items: [
            { productId: 'prod-1', productName: 'Deadbolt', quantity: 3 },
            { productId: 'prod-2', productName: 'Rekey kit', quantity: 2 },
          ],
          notes: 'Template: Standard van',
        },
        user,
      );
      expect(result.transfer?.items).toHaveLength(2);
      expect(result.moved.map((l) => [l.productId, l.willMove])).toEqual([
        ['prod-1', 3],
        ['prod-2', 2],
      ]);
      // Deadbolt: 5 missing, 3 in the store — still 2 short.
      expect(result.short.map((l) => [l.productId, l.missing, l.willMove])).toEqual([['prod-1', 5, 3]]);
    });

    it('keeps the notes the caller wrote', async () => {
      await service.fill('tpl-1', { containerId: 'c-1', warehouseId: 'wh-1', notes: 'Monday restock' }, user);

      expect(transfers.createTransfer.mock.calls[0][0].notes).toBe('Monday restock');
    });

    it('answers what is short without a transfer when nothing can move', async () => {
      stock.getQuantities.mockResolvedValue(new Map());

      const result = await service.fill('tpl-1', { containerId: 'c-1', warehouseId: 'wh-1' }, user);

      expect(transfers.createTransfer).not.toHaveBeenCalled();
      expect(result.transfer).toBeUndefined();
      expect(result.moved).toEqual([]);
      expect(result.short.map((l) => l.productId)).toEqual(['prod-1', 'prod-2', 'prod-3']);
    });

    // Товар міг перестати бути складським після створення шаблону: переміщення
    // пропускає його (skippedItems), і рядок лишається серед нестач.
    it('counts a line the transfer skipped as short, not moved', async () => {
      transfers.createTransfer.mockImplementation(async (dto: any) =>
        createMockTransfer({ items: dto.items.slice(0, 1), skippedItems: dto.items.slice(1) }),
      );

      const result = await service.fill('tpl-1', { containerId: 'c-1', warehouseId: 'wh-1' }, user);

      expect(result.moved.map((l) => l.productId)).toEqual(['prod-1']);
      expect(result.short.map((l) => [l.productId, l.willMove])).toEqual([
        ['prod-1', 3],
        ['prod-2', 0],
      ]);
    });

    it('lets a stock race surface as the transfer’s own 400', async () => {
      transfers.createTransfer.mockRejectedValue(new BadRequestException('Insufficient stock for product prod-1'));

      await expect(
        service.fill('tpl-1', { containerId: 'c-1', warehouseId: 'wh-1' }, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s on an unknown warehouse before moving anything', async () => {
      locations.findLocation.mockImplementation(async (type: LocationType, id: string) =>
        type === LocationType.WAREHOUSE ? null : createMockLocationSummary({ id }),
      );

      await expect(
        service.fill('tpl-1', { containerId: 'c-1', warehouseId: 'nope' }, user),
      ).rejects.toThrow(NotFoundException);
      expect(transfers.createTransfer).not.toHaveBeenCalled();
    });
  });
});

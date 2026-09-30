import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LocationType,
  type LocationStock,
  type LocationStockRow,
  type LocationSummary,
} from '@bitcrm/types';
import { ProductsRepository } from '../products/products.repository';
import { LocationsRepository } from './locations.repository';
import { StockRepository } from './stock.repository';
import { ContainerAssignmentResolver } from '../user-containers/container-assignment.resolver';
import { visibleLocations, type StockViewer } from './stock-visibility';

/** The product fields a Stock popup row shows — never the whole 1–2 KB row. */
const POPUP_PRODUCT_FIELDS = [
  'id',
  'name',
  'number',
  'sku',
  'category',
  'priceClient',
  'costCompany',
  'minimumStockLevel',
] as const;

/**
 * The Stock popup of one warehouse or container: every product it holds
 * (quantity > 0), with the catalog fields the popup shows, sorted by name.
 * The location's STOCK# rows are read to the end of the partition, then only
 * the popup's product fields, 100 keys a BatchGet, a few at once (the largest
 * location, ~1 300 rows, was 13 sequential full-row reads) — the web used to join the location's
 * stock with the whole stock-managed catalog (3 102 products, 32 sequential
 * requests, over 8 s). The scope rules are the Stock popup's and the lists':
 * a container needs `containers.view` and the containers data scope, a
 * warehouse `warehouses.view`.
 */
@Injectable()
export class LocationStockService {
  constructor(
    private readonly locationsRepository: LocationsRepository,
    private readonly stockRepository: StockRepository,
    private readonly productsRepository: ProductsRepository,
    private readonly assignments: ContainerAssignmentResolver,
  ) {}

  /**
   * `money` is `financials.view`: without it every row leaves `costCompany`
   * out (the owner's money rule); the client price stays.
   */
  async forLocation(
    type: LocationType,
    id: string,
    viewer?: StockViewer,
    { money = false }: { money?: boolean } = {},
  ): Promise<LocationStock> {
    const location = await this.locationsRepository.findLocation(type, id);
    if (!location) {
      const label = type === LocationType.WAREHOUSE ? 'Warehouse' : 'Container';
      throw new NotFoundException(`${label} "${id}" not found`);
    }
    await this.assertVisible(location, viewer);

    const pk = `${location.type === 'warehouse' ? 'WAREHOUSE' : 'CONTAINER'}#${location.id}`;
    const held = (await this.stockRepository.getStockLevels(pk)).filter((item) => item.quantity > 0);
    const products = held.length
      ? await this.productsRepository.findByIds(
          held.map((item) => item.productId),
          { attributes: POPUP_PRODUCT_FIELDS },
        )
      : [];
    const byId = new Map(products.map((product) => [product.id, product]));

    const rows: LocationStockRow[] = held.map((item) => {
      const product = byId.get(item.productId);
      // A stock row whose product row is gone keeps the name it stored.
      if (!product) {
        return { productId: item.productId, productName: item.productName, quantity: item.quantity };
      }
      return {
        productId: item.productId,
        productName: product.name ?? item.productName,
        ...(product.number !== undefined && { number: product.number }),
        ...(product.sku !== undefined && { sku: product.sku }),
        ...(product.category !== undefined && { category: product.category }),
        quantity: item.quantity,
        ...(product.priceClient !== undefined && { priceClient: product.priceClient }),
        ...(money && product.costCompany !== undefined && { costCompany: product.costCompany }),
        ...(typeof product.minimumStockLevel === 'number' && { minimumStockLevel: product.minimumStockLevel }),
      };
    });
    rows.sort((a, b) => a.productName.localeCompare(b.productName, undefined, { sensitivity: 'base' }));

    return {
      locationType: location.type,
      locationId: location.id,
      name: location.name,
      ...(location.description !== undefined && { description: location.description }),
      status: location.status,
      ...(location.placeholder && { placeholder: true }),
      rows,
    };
  }

  /** A location outside the caller's scope is a 403, before any stock is read. */
  private async assertVisible(location: LocationSummary, viewer?: StockViewer): Promise<void> {
    const visible = await visibleLocations(viewer, (userId) =>
      this.assignments.assignmentFor(userId),
    );
    const allowed = location.type === 'warehouse' ? visible.warehouses : visible.containers(location);
    if (!allowed) {
      throw new ForbiddenException(`This ${location.type} is outside your data scope`);
    }
  }
}

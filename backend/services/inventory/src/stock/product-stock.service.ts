import { Injectable, NotFoundException } from '@nestjs/common';
import { LocationType, type LocationSummary, type ProductStock } from '@bitcrm/types';
import { ProductsService } from '../products/products.service';
import { LocationsRepository } from './locations.repository';
import { StockRepository } from './stock.repository';
import { ContainerAssignmentResolver } from '../user-containers/container-assignment.resolver';
import { visibleLocations, type StockViewer } from './stock-visibility';

const PK_PREFIX: Record<LocationSummary['type'], string> = {
  warehouse: 'WAREHOUSE#',
  container: 'CONTAINER#',
};

/**
 * The "Stock" popup on an inventory item: every warehouse and van the caller
 * may see, with how many of the item each holds. Inactive locations are
 * listed too — Workiz shows its "N/A" vans — and a location the item never
 * reached shows zero. Workiz placeholders (locations deleted in Workiz) are
 * listed only while they still hold the item. `onHand` is the sum over the
 * rows shown. Each row also carries the location's own `totalUnits` /
 * `uniqueItems` (absent until backfilled).
 */
@Injectable()
export class ProductStockService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly locationsRepository: LocationsRepository,
    private readonly stockRepository: StockRepository,
    private readonly assignments: ContainerAssignmentResolver,
  ) {}

  async forProduct(productId: string, viewer?: StockViewer): Promise<ProductStock> {
    // Through the products cache: the item was usually just opened.
    const product = await this.productsService.loadForStock(productId);
    if (!product) {
      throw new NotFoundException(`Product "${productId}" not found`);
    }

    // The caller's scope and both kinds' index partitions, all at once.
    const [visible, warehouseKind, containerKind] = await Promise.all([
      visibleLocations(viewer, (userId) => this.assignments.assignmentFor(userId)),
      this.locationsRepository.listKind(LocationType.WAREHOUSE),
      this.locationsRepository.listKind(LocationType.CONTAINER),
    ]);
    // Warehouses first, then containers; each list in name order, the Workiz
    // placeholders of a kind after its real locations.
    const locations = [
      ...(visible.warehouses ? [...warehouseKind.locations, ...warehouseKind.placeholders] : []),
      ...containerKind.locations.filter(visible.containers),
      ...containerKind.placeholders.filter(visible.containers),
    ];
    const pkOf = (location: LocationSummary) => `${PK_PREFIX[location.type]}${location.id}`;

    const quantities = locations.length
      ? await this.stockRepository.getProductQuantities(productId, locations.map(pkOf))
      : new Map<string, number>();

    let onHand = 0;
    const rows = locations.flatMap((location) => {
      const quantity = quantities.get(pkOf(location)) ?? 0;
      // A placeholder is listed only while it still holds the item, so no
      // units become invisible — and 119 empty ones stay out of the popup.
      if (location.placeholder && quantity <= 0) return [];
      onHand += quantity;
      return [
        {
          locationType: location.type,
          locationId: location.id,
          name: location.name,
          description: location.description,
          status: location.status,
          quantity,
          ...(location.placeholder && { placeholder: true }),
          ...(location.totalUnits !== undefined && { totalUnits: location.totalUnits }),
          ...(location.uniqueItems !== undefined && { uniqueItems: location.uniqueItems }),
        },
      ];
    });

    return { productId, onHand, locations: rows };
  }
}

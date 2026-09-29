import { Injectable, NotFoundException } from '@nestjs/common';
import {
  LocationType,
  type LocationSummary,
  type ProductStock,
} from '@bitcrm/types';
import { ProductsRepository } from '../products/products.repository';
import { LocationsRepository } from './locations.repository';
import { StockRepository } from './stock.repository';

const PK_PREFIX: Record<LocationSummary['type'], string> = {
  warehouse: 'WAREHOUSE#',
  container: 'CONTAINER#',
};

/**
 * The "Stock" popup on an inventory item: every warehouse and van with how
 * many of the item each holds. Inactive locations are listed too — Workiz
 * shows its "N/A" vans — and a location the item never reached shows zero.
 */
@Injectable()
export class ProductStockService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly stockRepository: StockRepository,
  ) {}

  async forProduct(productId: string): Promise<ProductStock> {
    const product = await this.productsRepository.findById(productId);
    if (!product) {
      throw new NotFoundException(`Product "${productId}" not found`);
    }

    // Warehouses first, then containers; each list arrives in name order.
    const locations = [
      ...(await this.locationsRepository.listAll(LocationType.WAREHOUSE)),
      ...(await this.locationsRepository.listAll(LocationType.CONTAINER)),
    ];
    const pkOf = (location: LocationSummary) => `${PK_PREFIX[location.type]}${location.id}`;

    const quantities = locations.length
      ? await this.stockRepository.getProductQuantities(productId, locations.map(pkOf))
      : new Map<string, number>();

    let onHand = 0;
    const rows = locations.map((location) => {
      const quantity = quantities.get(pkOf(location)) ?? 0;
      onHand += quantity;
      return {
        locationType: location.type,
        locationId: location.id,
        name: location.name,
        description: location.description,
        status: location.status,
        quantity,
      };
    });

    return { productId, onHand, locations: rows };
  }
}

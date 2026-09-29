import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DataScope,
  LocationType,
  type JwtUser,
  type LocationSummary,
  type ProductStock,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { ProductsRepository } from '../products/products.repository';
import { LocationsRepository } from './locations.repository';
import { StockRepository } from './stock.repository';

const PK_PREFIX: Record<LocationSummary['type'], string> = {
  warehouse: 'WAREHOUSE#',
  container: 'CONTAINER#',
};

/** Who is asking: the request user and the permissions the guard resolved for them. */
export interface StockViewer {
  user: JwtUser;
  permissions?: ResolvedPermissions;
}

/**
 * The locations the caller's own list routes would show them, so the popup
 * and `GET /warehouses` / `GET /containers` agree: a warehouse needs
 * `warehouses.view`, a container `containers.view` plus the containers data
 * scope (`assigned_only` — their own van; `department` — their department's).
 * No resolved permissions means the guard did not run (unit tests) and the
 * Super Admin bypasses the matrix the way the guard lets them.
 */
function visibleLocations(viewer?: StockViewer): {
  warehouses: boolean;
  containers: (location: LocationSummary) => boolean;
} {
  const resolved = viewer?.permissions;
  if (!viewer || !resolved || (resolved.isSystemRole && resolved.roleName === 'Super Admin')) {
    return { warehouses: true, containers: () => true };
  }

  const warehouses = resolved.permissions.warehouses?.view === true;
  if (resolved.permissions.containers?.view !== true) {
    return { warehouses, containers: () => false };
  }
  switch (resolved.dataScope.containers) {
    case DataScope.ASSIGNED_ONLY:
      return { warehouses, containers: (l) => l.technicianId === viewer.user.id };
    case DataScope.DEPARTMENT:
      return { warehouses, containers: (l) => l.department === viewer.user.department };
    default:
      return { warehouses, containers: () => true };
  }
}

/**
 * The "Stock" popup on an inventory item: every warehouse and van the caller
 * may see, with how many of the item each holds. Inactive locations are
 * listed too — Workiz shows its "N/A" vans — and a location the item never
 * reached shows zero. `onHand` is the sum over the rows shown.
 */
@Injectable()
export class ProductStockService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly stockRepository: StockRepository,
  ) {}

  async forProduct(productId: string, viewer?: StockViewer): Promise<ProductStock> {
    const product = await this.productsRepository.findById(productId);
    if (!product) {
      throw new NotFoundException(`Product "${productId}" not found`);
    }

    const visible = visibleLocations(viewer);
    // Warehouses first, then containers; each list arrives in name order.
    const locations = [
      ...(visible.warehouses ? await this.locationsRepository.listAll(LocationType.WAREHOUSE) : []),
      ...(await this.locationsRepository.listAll(LocationType.CONTAINER)).filter(visible.containers),
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

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
import { ContainerAssignmentResolver } from '../user-containers/container-assignment.resolver';

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
 * scope (`assigned_only` — the van they are assigned to, `ownContainerId`;
 * `department` — their department's). No resolved permissions means the guard
 * did not run (unit tests) and the Super Admin bypasses the matrix the way
 * the guard lets them.
 */
async function visibleLocations(
  viewer: StockViewer | undefined,
  ownContainerId: (userId: string) => Promise<string | undefined>,
): Promise<{
  warehouses: boolean;
  containers: (location: LocationSummary) => boolean;
}> {
  const resolved = viewer?.permissions;
  if (!viewer || !resolved || (resolved.isSystemRole && resolved.roleName === 'Super Admin')) {
    return { warehouses: true, containers: () => true };
  }

  const warehouses = resolved.permissions.warehouses?.view === true;
  if (resolved.permissions.containers?.view !== true) {
    return { warehouses, containers: () => false };
  }
  switch (resolved.dataScope.containers) {
    case DataScope.ASSIGNED_ONLY: {
      const own = await ownContainerId(viewer.user.id);
      return { warehouses, containers: (l) => own !== undefined && l.id === own };
    }
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
 * reached shows zero. Workiz placeholders (locations deleted in Workiz) are
 * listed only while they still hold the item. `onHand` is the sum over the
 * rows shown.
 */
@Injectable()
export class ProductStockService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly stockRepository: StockRepository,
    private readonly assignments: ContainerAssignmentResolver,
  ) {}

  async forProduct(productId: string, viewer?: StockViewer): Promise<ProductStock> {
    const product = await this.productsRepository.findById(productId);
    if (!product) {
      throw new NotFoundException(`Product "${productId}" not found`);
    }

    const visible = await visibleLocations(viewer, (userId) =>
      this.assignments.containerIdForUser(userId),
    );
    // Warehouses first, then containers; each list arrives in name order, the
    // Workiz placeholders of a kind after its real locations.
    const [warehouses, warehousePlaceholders] = visible.warehouses
      ? await Promise.all([
          this.locationsRepository.listAll(LocationType.WAREHOUSE),
          this.locationsRepository.listPlaceholders(LocationType.WAREHOUSE),
        ])
      : [[], []];
    const [containers, containerPlaceholders] = await Promise.all([
      this.locationsRepository.listAll(LocationType.CONTAINER),
      this.locationsRepository.listPlaceholders(LocationType.CONTAINER),
    ]);
    const locations = [
      ...warehouses,
      ...warehousePlaceholders,
      ...containers.filter(visible.containers),
      ...containerPlaceholders.filter(visible.containers),
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
        },
      ];
    });

    return { productId, onHand, locations: rows };
  }
}

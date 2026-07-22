import { SearchDocument, SearchType } from '@bitcrm/types';
import {
  mapDeal,
  mapContact,
  mapCompany,
  mapUser,
  mapTechnician,
  mapProduct,
  mapWarehouse,
  mapContainer,
  mapTransfer,
} from './mappers/search-mappers';
import { TechnicianSearchInput } from './mappers/mapper-input';

/**
 * Routes a full entity (from a backfill fetch or an entity-carrying event) to the
 * mapper for its type. `technician` and `stock` take assembled inputs rather than
 * a single stored entity, so they are indexed directly via their mappers.
 *
 * `jobTypeName` is pre-resolved by the caller because mappers stay pure/sync —
 * only deals need it.
 */
export function routeToDocument(
  type: SearchType,
  entity: any,
  jobTypeName?: string,
): SearchDocument | null {
  switch (type) {
    case 'deal':
      return mapDeal(entity, jobTypeName);
    case 'contact':
      return mapContact(entity);
    case 'company':
      return mapCompany(entity);
    case 'user':
      return mapUser(entity);
    case 'technician':
      return mapTechnician(entity as TechnicianSearchInput);
    case 'product':
      return mapProduct(entity);
    case 'warehouse':
      return mapWarehouse(entity);
    case 'container':
      return mapContainer(entity);
    case 'transfer':
      return mapTransfer(entity);
    default:
      return null;
  }
}

import { SearchDocument, SearchType } from '@bitcrm/types';
import {
  mapDeal,
  mapContact,
  mapCompany,
  mapConversation,
  mapUser,
  mapTechnician,
  mapProduct,
  mapWarehouse,
  mapContainer,
  mapTransfer,
} from './mappers/search-mappers';
import {
  ConversationSearchInput,
  CustomFieldSearchDef,
  DealClientSearchInput,
  TechnicianSearchInput,
} from './mappers/mapper-input';

/**
 * Routes a full entity (from a backfill fetch or an entity-carrying event) to the
 * mapper for its type. `technician` and `stock` take assembled inputs rather than
 * a single stored entity, so they are indexed directly via their mappers.
 *
 * `jobTypeName` / `tagNames` / `customFieldDefs` / `client` are pre-resolved by
 * the caller because mappers stay pure/sync — only deals need them;
 * `conversation` (party name, last messages, jobs) likewise only for conversations.
 */
export function routeToDocument(
  type: SearchType,
  entity: any,
  jobTypeName?: string,
  tagNames: string[] = [],
  customFieldDefs: CustomFieldSearchDef[] = [],
  client?: DealClientSearchInput,
  externalCompanyName?: string,
  conversation?: ConversationSearchInput,
): SearchDocument | null {
  switch (type) {
    case 'deal':
      return mapDeal(entity, jobTypeName, tagNames, customFieldDefs, client, externalCompanyName);
    case 'conversation':
      return mapConversation(entity, conversation);
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

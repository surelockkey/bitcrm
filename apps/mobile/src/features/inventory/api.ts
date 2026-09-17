import { http } from '../../lib/api/http';
import type { MyContainer, StockItem } from './types';

/**
 * The technician's own van.
 *
 * The same endpoint the web's "My stock" page calls
 * (`apps/web/features/inventory/containers/api.ts:57`). Answers **404** when
 * the office has not assigned this technician a container — that is a real and
 * ordinary state, not a failure, and the screen says so in words.
 */
export const getMyContainer = (): Promise<MyContainer> =>
  http.get<MyContainer>('/inventory/containers/my');

/**
 * What is in it, one row per product, with the product's name already on the
 * row. Guarded by `containers.view`, which the technician role holds.
 *
 * Rows with a zero quantity come back too — the container remembers a product
 * it has run out of — and are dropped on the way in, the same way the web
 * does (`containers/hooks.ts:88-91`). A part the van does not have is not a
 * line on a list a technician is scanning for the part they need.
 */
export const getContainerStock = (containerId: string): Promise<StockItem[]> =>
  http.get<StockItem[]>(`/inventory/containers/${containerId}/stock`);

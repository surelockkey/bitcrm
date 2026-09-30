import type {
  Container,
  InventoryStatus,
  LocationSummaryType,
  LocationType,
  ReturnReason,
  Transfer,
  TransferItem,
  Warehouse,
} from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";

/** A location that holds stock, spelled either way the web has it. */
export type StockLocationType = LocationSummaryType | LocationType.WAREHOUSE | LocationType.CONTAINER;

/* --- Movements (Workiz "Add stock" / "Move" / "Return") --- */

export interface ReceiveStockBody {
  toType: StockLocationType;
  toId: string;
  items: TransferItem[];
  notes?: string;
}

export interface ReturnStockBody {
  fromType: StockLocationType;
  fromId: string;
  items: TransferItem[];
  reason: ReturnReason;
  notes?: string;
}

export interface MoveStockBody {
  fromType: StockLocationType;
  fromId: string;
  toType: StockLocationType;
  toId: string;
  items: TransferItem[];
  notes?: string;
}

/** From the supplier into a warehouse or a van. */
export function receiveStock(body: ReceiveStockBody): Promise<Transfer> {
  return http.post<Transfer>("/inventory/transfers/receive", body);
}

/** Out of a location without a job: recalled, damaged, lost. */
export function returnStock(body: ReturnStockBody): Promise<Transfer> {
  return http.post<Transfer>("/inventory/transfers/return", body);
}

/** Between any two locations, warehouse→warehouse included. */
export function moveStock(body: MoveStockBody): Promise<Transfer> {
  return http.post<Transfer>("/inventory/transfers", body);
}

/* --- One location's stock --- */

/**
 * One row of a location's stock, named and priced by the server. Only what
 * the location holds (quantity > 0), in item-name order.
 */
export interface LocationStockRow {
  productId: string;
  productName: string;
  /** The item's short "Product ID". */
  number?: number;
  sku?: string;
  category?: string;
  quantity: number;
  priceClient?: number;
  costCompany?: number;
  /**
   * The item's low-stock line. Not part of the endpoint's answer yet; the
   * views mark a row low only when it arrives.
   */
  minimumStockLevel?: number;
}

/** `GET /inventory/stock/locations/:type/:id` — a warehouse's or van's shelf. */
export interface LocationStock {
  locationType: LocationSummaryType;
  locationId: string;
  name: string;
  description?: string;
  status: InventoryStatus;
  rows: LocationStockRow[];
}

/**
 * Everything one warehouse or van holds, in one request. The rows come
 * joined to the catalog server-side — the browser used to page the whole
 * stock-managed catalog (3 102 items, 32 sequential requests) to name them.
 */
export function getLocationStock(type: LocationSummaryType, id: string): Promise<LocationStock> {
  return http.get<LocationStock>(`/inventory/stock/locations/${type}/${encodeURIComponent(id)}`);
}

/* --- Every location, for pickers --- */

const PAGE = 100;
/** Far above any real fleet; only here so a looping cursor cannot spin forever. */
const CAP = 2000;

async function fetchEvery<T>(path: string): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (cursor) q.set("cursor", cursor);
    const page = await apiFetchPaginated<T>(`${path}?${q}`);
    all.push(...page.data);
    cursor = page.pagination.nextCursor;
  } while (cursor && all.length < CAP);
  return all.slice(0, CAP);
}

export function fetchAllWarehouses(): Promise<Warehouse[]> {
  return fetchEvery<Warehouse>("/inventory/warehouses");
}

export function fetchAllContainers(): Promise<Container[]> {
  return fetchEvery<Container>("/inventory/containers");
}

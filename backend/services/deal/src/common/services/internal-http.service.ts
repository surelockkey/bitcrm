import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { BusinessMetricsService } from '@bitcrm/shared';
import {
  type Company,
  type Contact,
  type PersonName,
  type Product,
} from '@bitcrm/types';
import {
  CRM_SERVICE_URL,
  USER_SERVICE_URL,
  INVENTORY_SERVICE_URL,
  INTERNAL_SERVICE_SECRET,
} from '../constants/services.constants';

/** What crm's names endpoint accepts in one body, and a page of jobs holds. */
const CONTACT_NAMES_MAX_IDS = 100;
/** The jobs list renders without the names, so it never waits long for them. */
const CONTACT_NAMES_TIMEOUT_MS = 3_000;
/** A scoreboard's rows — more than that is not a glance. */
const USER_NAMES_MAX_IDS = 20;
const USER_NAMES_TIMEOUT_MS = 3_000;
/** user-service's batch names route takes this many ids in one body. */
const USER_NAMES_BATCH_MAX_IDS = 200;
/** Price-book reads a report sends at once — inventory answers one product a request. */
const PRODUCTS_PARALLEL = 8;
const PRODUCT_TIMEOUT_MS = 5_000;
/** crm's `POST /contacts/by-ids` takes this many ids in one body. */
const CONTACTS_BY_IDS_MAX = 100;
const CONTACTS_BY_IDS_TIMEOUT_MS = 5_000;

/**
 * A technician's eligibility as user-service reports it. Carries the display
 * fields too, so the deal-service projection can render the assignment dialog
 * without a second round trip.
 */
export interface TechnicianEligibilityInfo {
  technicianId: string;
  assignable: boolean;
  jobTypeIds: string[];
  serviceAreaIds: string[];
  firstName?: string;
  lastName?: string;
  department?: string;
  homeAddress?: { lat: number; lng: number };
}

export interface DeductStockDto {
  containerId: string;
  items: Array<{ productId: string; productName: string; quantity: number }>;
  dealId: string;
  performedBy: string;
  performedByName: string;
}

export interface RestoreStockDto {
  containerId: string;
  items: Array<{ productId: string; productName: string; quantity: number }>;
  dealId: string;
  performedBy: string;
  performedByName: string;
}

@Injectable()
export class InternalHttpService {
  private readonly logger = new Logger(InternalHttpService.name);
  private readonly crmClient: AxiosInstance;
  /** crm's PUBLIC routes, called with the caller's own token — never the internal secret. */
  private readonly crmAsCallerClient: AxiosInstance;
  private readonly userClient: AxiosInstance;
  private readonly inventoryClient: AxiosInstance;

  constructor(
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {
    const headers = { 'x-internal-secret': INTERNAL_SERVICE_SECRET };

    this.crmClient = axios.create({ baseURL: CRM_SERVICE_URL, headers });
    this.crmAsCallerClient = axios.create({ baseURL: CRM_SERVICE_URL });
    this.userClient = axios.create({ baseURL: USER_SERVICE_URL, headers });
    this.inventoryClient = axios.create({ baseURL: INVENTORY_SERVICE_URL, headers });
  }

  async validateContact(contactId: string): Promise<boolean> {
    const timer = this.businessMetrics?.internalHttpDuration.startTimer({ target_service: 'crm', operation: 'validateContact' });
    try {
      await this.crmClient.get(`/api/crm/contacts/internal/${contactId}`);
      timer?.();
      return true;
    } catch (error: any) {
      timer?.();
      if (error.response?.status === 404) {
        return false;
      }
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'crm', operation: 'validateContact' });
      this.logger.warn(`Failed to validate contact ${contactId}: ${error.message}`);
      throw error;
    }
  }

  /** Full contact (tax exemption, names, addresses). Null when it doesn't exist. */
  async getContact(contactId: string): Promise<Contact | null> {
    return this.getCrmEntity<Contact>(`/api/crm/contacts/internal/${contactId}`, 'getContact');
  }

  /**
   * Names for a set of contact ids — the clients of a page of jobs, side-loaded
   * with that page instead of fetched once the browser has read the ids out of
   * it.
   *
   * **Names only.** Numbers and emails are not copied out of the answer and
   * must not be: crm masks a contact's numbers for a caller without
   * `contacts.view_numbers`, deal-service masks nothing, so a number carried
   * here would reach every holder of `deals.view`.
   *
   * Best effort, like an event publish: the list renders without it, so a crm
   * that is down, slow or answering nonsense costs an empty array and a
   * warning, never the page. Ids are deduped and capped at
   * `CONTACT_NAMES_MAX_IDS`, which is also crm's own limit.
   */
  async getContactNames(ids: string[]): Promise<PersonName[]> {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, CONTACT_NAMES_MAX_IDS);
    if (!unique.length) return [];

    const timer = this.businessMetrics?.internalHttpDuration.startTimer({ target_service: 'crm', operation: 'getContactNames' });
    try {
      const response = await this.crmClient.post(
        '/api/crm/contacts/internal/names-by-ids',
        { ids: unique },
        { timeout: CONTACT_NAMES_TIMEOUT_MS },
      );
      timer?.();
      const rows: unknown = response.data?.data;
      if (!Array.isArray(rows)) return [];
      // Rebuilt field by field, never spread: whatever else crm sends stays there.
      return rows
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof (row as { id?: unknown }).id === 'string')
        .map((row) => ({
          id: row.id as string,
          firstName: typeof row.firstName === 'string' ? row.firstName : '',
          lastName: typeof row.lastName === 'string' ? row.lastName : '',
        }));
    } catch (error: any) {
      timer?.();
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'crm', operation: 'getContactNames' });
      this.logger.warn(`Failed to load names for ${unique.length} contacts: ${error.message}`);
      return [];
    }
  }

  /**
   * Names of a handful of users — the people on a dashboard scoreboard.
   *
   * One lookup each on user-service's internal route, all at once: a board
   * holds five people, and user-service has no batch route for names. Names
   * only, rebuilt field by field; a user it cannot fetch is left out rather
   * than failing the board, which then shows the row without a name.
   */
  async getUserNames(ids: string[]): Promise<PersonName[]> {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, USER_NAMES_MAX_IDS);
    const rows = await Promise.all(
      unique.map(async (id): Promise<PersonName | null> => {
        try {
          const response = await this.userClient.get(`/api/users/internal/${id}`, {
            timeout: USER_NAMES_TIMEOUT_MS,
          });
          const user = response.data?.data;
          if (!user || typeof user.id !== 'string') return null;
          return {
            id: user.id,
            firstName: typeof user.firstName === 'string' ? user.firstName : '',
            lastName: typeof user.lastName === 'string' ? user.lastName : '',
          };
        } catch (error: any) {
          this.logger.warn(`Failed to load the name of user ${id}: ${error.message}`);
          return null;
        }
      }),
    );
    return rows.filter((row): row is PersonName => row !== null);
  }

  /**
   * Names of many users at once — the technicians and creators across a
   * report window. user-service's batch route (`internal/names-by-ids`,
   * 200 ids a body), several bodies in parallel. Names only, rebuilt field by
   * field; a batch that fails costs its names and a warning, never the report.
   */
  async getUserNamesBatch(ids: string[]): Promise<PersonName[]> {
    const unique = [...new Set(ids.filter(Boolean))];
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += USER_NAMES_BATCH_MAX_IDS) batches.push(unique.slice(i, i + USER_NAMES_BATCH_MAX_IDS));
    const results = await Promise.all(
      batches.map(async (userIds): Promise<PersonName[]> => {
        try {
          const response = await this.userClient.post('/api/users/internal/names-by-ids', { userIds }, { timeout: USER_NAMES_TIMEOUT_MS });
          const rows: unknown = response.data?.data;
          if (!Array.isArray(rows)) return [];
          return rows
            .filter((row): row is Record<string, unknown> => Boolean(row) && typeof (row as { id?: unknown }).id === 'string')
            .map((row) => ({
              id: row.id as string,
              firstName: typeof row.firstName === 'string' ? row.firstName : '',
              lastName: typeof row.lastName === 'string' ? row.lastName : '',
            }));
        } catch (error: any) {
          this.logger.warn(`Failed to load names for ${userIds.length} users: ${error.message}`);
          return [];
        }
      }),
    );
    return results.flat();
  }

  /**
   * Contacts as THE CALLER may see them: crm's public `POST /contacts/by-ids`
   * with the caller's own bearer token, so crm masks the numbers exactly as
   * it would for them (`contacts.view_numbers`) — this service never decides
   * that on crm's behalf. For a report's rows whose job carries no number or
   * email of its own. At most 100 ids; best effort — a caller without
   * `contacts.view`, or a crm that is down, gets an empty answer.
   */
  async getContactsAsCaller(ids: string[], authorization: string | undefined): Promise<Contact[]> {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, CONTACTS_BY_IDS_MAX);
    if (!unique.length || !authorization) return [];
    try {
      const response = await this.crmAsCallerClient.post(
        '/api/crm/contacts/by-ids',
        { ids: unique },
        { headers: { authorization }, timeout: CONTACTS_BY_IDS_TIMEOUT_MS },
      );
      const rows: unknown = response.data?.data;
      return Array.isArray(rows) ? (rows as Contact[]) : [];
    } catch (error: any) {
      this.logger.warn(`Failed to load ${unique.length} contacts as the caller: ${error.message}`);
      return [];
    }
  }

  /** Full company (tax exemption, title). Null when it doesn't exist. */
  async getCompany(companyId: string): Promise<Company | null> {
    return this.getCrmEntity<Company>(`/api/crm/companies/internal/${companyId}`, 'getCompany');
  }

  private async getCrmEntity<T>(path: string, operation: string): Promise<T | null> {
    const timer = this.businessMetrics?.internalHttpDuration.startTimer({ target_service: 'crm', operation });
    try {
      const response = await this.crmClient.get(path);
      timer?.();
      return (response.data?.data ?? null) as T | null;
    } catch (error: any) {
      timer?.();
      if (error?.response?.status === 404) return null;
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'crm', operation });
      throw this.toHttpError(error, `CRM ${operation}`);
    }
  }

  /**
   * A user's eligibility as user-service sees it, or a thrown error.
   *
   * It used to answer "not assignable" for a failed call too, which the
   * projection acts on by DELETING the row — one user-service hiccup and a
   * working technician silently left the assignment dialog until the next
   * boot. "User-service says no" (including a 404: no such user) and
   * "user-service did not answer" are now different outcomes, and the caller
   * lets SQS retry the second.
   */
  async getTechnicianEligibility(technicianId: string): Promise<TechnicianEligibilityInfo> {
    const timer = this.businessMetrics?.internalHttpDuration.startTimer({ target_service: 'user', operation: 'getTechnicianEligibility' });
    try {
      const response = await this.userClient.get(
        `/api/users/internal/technicians/${technicianId}/eligibility`,
      );
      timer?.();
      return response.data.data;
    } catch (error: any) {
      timer?.();
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'user', operation: 'getTechnicianEligibility' });
      if (error.response?.status === 404) {
        return { technicianId, assignable: false, jobTypeIds: [], serviceAreaIds: [] };
      }
      this.logger.warn(`Failed to get eligibility for ${technicianId}: ${error.message}`);
      throw this.toHttpError(error, 'Technician eligibility lookup');
    }
  }

  /**
   * The full roster of assignable technicians, or `null` when user-service
   * could not answer. Null and empty are deliberately different: the reconcile
   * removes projection rows that are missing from this list, and "the list is
   * empty because the call failed" would take out every technician at once.
   */
  async listAssignableTechnicians(): Promise<TechnicianEligibilityInfo[] | null> {
    const timer = this.businessMetrics?.internalHttpDuration.startTimer({ target_service: 'user', operation: 'listAssignableTechnicians' });
    try {
      const response = await this.userClient.get('/api/users/internal/technicians/assignable');
      timer?.();
      return response.data.data || [];
    } catch (error: any) {
      timer?.();
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'user', operation: 'listAssignableTechnicians' });
      this.logger.warn(`Failed to list assignable technicians: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch a product from inventory to validate a deal line (existence + type).
   * Returns null when the product does not exist (404); other failures surface
   * as a 502 so callers can distinguish "not found" from "inventory is down".
   */
  async getProduct(productId: string): Promise<Product | null> {
    const timer = this.businessMetrics?.internalHttpDuration.startTimer({ target_service: 'inventory', operation: 'getProduct' });
    try {
      const response = await this.inventoryClient.get(
        `/api/inventory/products/internal/${productId}`,
      );
      timer?.();
      return response.data.data as Product;
    } catch (error: any) {
      timer?.();
      if (error.response?.status === 404) {
        return null;
      }
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'inventory', operation: 'getProduct' });
      throw this.toHttpError(error, 'Product lookup');
    }
  }

  /**
   * Many price-book items at once, for a report that prints their current
   * name, type, model and category (Items and services). Inventory has no
   * batch route, so this is `GET /products/internal/:id` per product,
   * `PRODUCTS_PARALLEL` at a time, each answer as inventory sent it (the
   * importer's extras — `number`, `workizType`, `workizSerial` — included).
   * Best effort: a product inventory does not know, or cannot answer for, is
   * left out with one warning for the lot, and the report prints the line's
   * own words for it. An inventory that answers nothing but errors is asked
   * no further.
   */
  async getProductsForReport(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
    const unique = [...new Set(ids.filter(Boolean))];
    const out = new Map<string, Record<string, unknown>>();
    let failed = 0;
    let lastError = '';
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < unique.length) {
        // Inventory down (every answer so far an error): stop asking, do not wait out a timeout per item.
        if (failed >= PRODUCTS_PARALLEL && out.size === 0) return;
        const id = unique[next++];
        try {
          const response = await this.inventoryClient.get(`/api/inventory/products/internal/${encodeURIComponent(id)}`, {
            timeout: PRODUCT_TIMEOUT_MS,
          });
          const product: unknown = response.data?.data;
          if (product && typeof product === 'object') out.set(id, product as Record<string, unknown>);
        } catch (error: any) {
          if (error.response?.status === 404) continue;
          failed += 1;
          lastError = error.message;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PRODUCTS_PARALLEL, unique.length) }, worker));
    if (failed) {
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'inventory', operation: 'getProductsForReport' });
      this.logger.warn(`Failed to load ${failed} of ${unique.length} products for a report: ${lastError}`);
    }
    return out;
  }

  async deductStock(dto: DeductStockDto): Promise<void> {
    const timer = this.businessMetrics?.internalHttpDuration.startTimer({ target_service: 'inventory', operation: 'deductStock' });
    try {
      await this.inventoryClient.post('/api/inventory/transfers/internal/stock/deduct', dto);
      timer?.();
    } catch (error) {
      timer?.();
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'inventory', operation: 'deductStock' });
      throw this.toHttpError(error, 'Stock deduction');
    }
  }

  async restoreStock(dto: RestoreStockDto): Promise<void> {
    const timer = this.businessMetrics?.internalHttpDuration.startTimer({ target_service: 'inventory', operation: 'restoreStock' });
    try {
      await this.inventoryClient.post('/api/inventory/transfers/internal/stock/restore', dto);
      timer?.();
    } catch (error) {
      timer?.();
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'inventory', operation: 'restoreStock' });
      throw this.toHttpError(error, 'Stock restore');
    }
  }

  /**
   * Translate a failed internal service call into a client-facing
   * HttpException. A downstream 4xx (e.g. inventory's "Insufficient stock")
   * is surfaced with its own status + message so callers get a meaningful
   * error instead of a generic 500; network failures / 5xx become a 502.
   */
  private toHttpError(error: unknown, action: string): HttpException {
    const response = (
      error as { response?: { status?: number; data?: unknown } } | undefined
    )?.response;
    if (response && typeof response.status === 'number') {
      const data = response.data as
        | { error?: { message?: string }; message?: string }
        | undefined;
      const message =
        data?.error?.message ??
        data?.message ??
        (error instanceof Error ? error.message : 'Request failed');
      if (response.status >= 400 && response.status < 500) {
        return new HttpException(message, response.status);
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    return new BadGatewayException(`${action} failed: ${detail}`);
  }
}

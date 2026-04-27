import { Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { BusinessMetricsService } from '@bitcrm/shared';
import {
  CRM_SERVICE_URL,
  USER_SERVICE_URL,
  INVENTORY_SERVICE_URL,
  INTERNAL_SERVICE_SECRET,
} from '../constants/services.constants';

export interface TechnicianInfo {
  id: string;
  firstName: string;
  lastName: string;
  skills: string[];
  serviceAreas: string[];
  homeAddress?: { lat: number; lng: number };
  department: string;
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
  private readonly userClient: AxiosInstance;
  private readonly inventoryClient: AxiosInstance;

  constructor(
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {
    const headers = { 'x-internal-secret': INTERNAL_SERVICE_SECRET };

    this.crmClient = axios.create({ baseURL: CRM_SERVICE_URL, headers });
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

  async getTechnicians(filters?: {
    serviceArea?: string;
    skill?: string;
  }): Promise<TechnicianInfo[]> {
    const timer = this.businessMetrics?.internalHttpDuration.startTimer({ target_service: 'user', operation: 'getTechnicians' });
    try {
      const params: Record<string, string> = {};
      if (filters?.serviceArea) params.serviceArea = filters.serviceArea;
      if (filters?.skill) params.skill = filters.skill;

      const response = await this.userClient.get('/api/users/internal/technicians', { params });
      timer?.();
      return response.data.data || [];
    } catch (error: any) {
      timer?.();
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'user', operation: 'getTechnicians' });
      this.logger.warn(`Failed to get technicians: ${error.message}`);
      return [];
    }
  }

  async deductStock(dto: DeductStockDto): Promise<void> {
    const timer = this.businessMetrics?.internalHttpDuration.startTimer({ target_service: 'inventory', operation: 'deductStock' });
    try {
      await this.inventoryClient.post('/api/inventory/transfers/internal/stock/deduct', dto);
      timer?.();
    } catch (error) {
      timer?.();
      this.businessMetrics?.internalHttpErrors.inc({ target_service: 'inventory', operation: 'deductStock' });
      throw error;
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
      throw error;
    }
  }
}

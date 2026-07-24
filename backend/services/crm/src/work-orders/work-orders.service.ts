import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Service } from '@bitcrm/shared';
import { WorkOrderStatus, type WorkOrder } from '@bitcrm/types';
import { WorkOrdersRepository } from './work-orders.repository';
import { type CreateWorkOrderDto } from './dto/create-work-order.dto';
import { type UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { type ListWorkOrdersQueryDto } from './dto/list-work-orders-query.dto';
import { workOrderS3Key } from '../common/constants/dynamo.constants';

@Injectable()
export class WorkOrdersService {
  private readonly logger = new Logger(WorkOrdersService.name);

  constructor(
    private readonly repository: WorkOrdersRepository,
    private readonly s3: S3Service,
  ) {}

  /** WO numbers are the human identity, so they must be unique (case-insensitive). */
  private async assertNumberAvailable(woNumber: string, excludeId?: string): Promise<void> {
    const all = await this.repository.listAll();
    const clash = all.find(
      (w) => w.id !== excludeId && w.woNumber.trim().toLowerCase() === woNumber.trim().toLowerCase(),
    );
    if (clash) throw new ConflictException(`Work order "${clash.woNumber}" already exists`);
  }

  async create(dto: CreateWorkOrderDto, caller: { id: string }): Promise<WorkOrder> {
    await this.assertNumberAvailable(dto.woNumber);
    const now = new Date().toISOString();
    const workOrder: WorkOrder = {
      id: randomUUID(),
      woNumber: dto.woNumber,
      companyId: dto.companyId,
      dealId: dto.dealId,
      date: dto.date,
      amount: dto.amount,
      description: dto.description,
      status: WorkOrderStatus.OPEN,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(workOrder);
    this.logger.log(`Created work order ${workOrder.woNumber} for company ${dto.companyId}`);
    return workOrder;
  }

  async list(query: ListWorkOrdersQueryDto): Promise<WorkOrder[]> {
    const all = await this.repository.listAll();
    return all.filter(
      (w) =>
        (!query.companyId || w.companyId === query.companyId) &&
        (!query.status || w.status === query.status),
    );
  }

  async findById(id: string): Promise<WorkOrder> {
    const wo = await this.repository.get(id);
    if (!wo) throw new NotFoundException(`Work order ${id} not found`);
    return wo;
  }

  async update(id: string, dto: UpdateWorkOrderDto): Promise<WorkOrder> {
    const existing = await this.findById(id);
    if (dto.woNumber !== undefined) await this.assertNumberAvailable(dto.woNumber, id);

    const updated: WorkOrder = {
      ...existing,
      woNumber: dto.woNumber ?? existing.woNumber,
      date: dto.date ?? existing.date,
      amount: dto.amount ?? existing.amount,
      description: dto.description ?? existing.description,
      dealId: dto.dealId ?? existing.dealId,
      status: dto.status ?? existing.status,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.put(updated);
    return updated;
  }

  /**
   * A WO already linked to a deal is historical evidence — archive it rather
   * than destroy the audit trail. An unlinked WO (never used) is removed.
   */
  async remove(id: string, caller: { id: string }): Promise<{ archived: boolean }> {
    const existing = await this.findById(id);
    if (existing.dealId) {
      await this.repository.put({
        ...existing,
        status: WorkOrderStatus.ARCHIVED,
        updatedAt: new Date().toISOString(),
      });
      this.logger.log(`Archived work order ${id} — linked to deal ${existing.dealId}`);
      return { archived: true };
    }
    await this.repository.remove(id);
    void caller;
    return { archived: false };
  }

  async requestDocumentUpload(
    id: string,
    dto: { contentType: string },
  ): Promise<{ uploadUrl: string; s3Key: string; headers: Record<string, string> }> {
    const existing = await this.findById(id);
    const s3Key = workOrderS3Key(id);
    const { url: uploadUrl, headers } = await this.s3.getPresignedUpload(s3Key, {
      contentType: dto.contentType,
      kmsKeyId: process.env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents',
    });
    await this.repository.put({ ...existing, s3Key, updatedAt: new Date().toISOString() });
    return { uploadUrl, s3Key, headers };
  }
}

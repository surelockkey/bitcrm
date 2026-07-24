import { WorkOrderStatus } from '../enums/work-order-status.enum';

/**
 * A platinum client's Work Order — the authorization document behind one or
 * more jobs. Lives in the CRM service (company-scoped) and optionally links to
 * a deal. The uploaded PDF is served via short-TTL presigned URLs (`s3Key`).
 */
export interface WorkOrder {
  id: string;
  /** Human reference, unique (case-insensitive), e.g. "WO-2026-11-005". */
  woNumber: string;
  companyId: string;
  /** The deal this WO authorized, once created. */
  dealId?: string;
  /** Local date "YYYY-MM-DD". */
  date: string;
  amount?: number;
  description?: string;
  /** S3 key of the uploaded WO document, if any. */
  s3Key?: string;
  status: WorkOrderStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { S3Service, SnsPublisherService } from '@bitcrm/shared';
import { type JwtUser, type DocumentType } from '@bitcrm/types';
import { DocumentsRepository } from './documents.repository';
import { AuditRepository } from './audit.repository';
import { RolesService } from '../../roles/roles.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { documentS3Key } from '../constants/dynamo.constants';

const TECHNICIAN_ROLE_ID = 'role-technician';
const ADMIN_ROLE_ID = 'role-admin';
const USER_EVENTS_TOPIC = 'user-events';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly s3: S3Service,
    private readonly repository: DocumentsRepository,
    private readonly audit: AuditRepository,
    private readonly rolesService: RolesService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  async requestUpload(
    userId: string,
    dto: UploadDocumentDto,
    caller: JwtUser,
  ): Promise<{
    uploadUrl: string;
    s3Key: string;
    headers: Record<string, string>;
  }> {
    if (caller.id !== userId) {
      throw new ForbiddenException('You can only upload your own documents');
    }
    const s3Key = documentS3Key(userId, dto.docType);
    // The SSE-KMS headers are part of the signature — the client MUST send them
    // back on the PUT, so hand them over rather than leaving the browser to
    // guess (and 403).
    const { url: uploadUrl, headers } = await this.s3.getPresignedUpload(s3Key, {
      contentType: dto.contentType,
      kmsKeyId: process.env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents',
    });

    const now = new Date().toISOString();
    await this.repository.upsert({
      userId,
      docType: dto.docType,
      s3Key,
      contentType: dto.contentType,
      uploadedBy: caller.id,
      uploadedAt: now,
    });

    await this.writeAudit(userId, caller.id, 'document.uploaded', dto.docType);
    this.publish('document.uploaded', { technicianId: userId, docType: dto.docType });
    this.logger.log(`Document upload requested: ${userId}/${dto.docType} by ${caller.id}`);
    return { uploadUrl, s3Key, headers };
  }

  async getDownloadUrl(
    userId: string,
    docType: DocumentType,
    caller: JwtUser,
  ): Promise<{ downloadUrl: string }> {
    await this.assertCanView(caller, userId);
    const doc = await this.repository.getByType(userId, docType);
    if (!doc) throw new NotFoundException('Document not found');

    const downloadUrl = await this.s3.getPresignedDownloadUrl(doc.s3Key, 300);
    await this.writeAudit(userId, caller.id, 'document.viewed', docType);
    this.publish('document.accessed', { technicianId: userId, docType, actorId: caller.id });
    this.logger.log(`Document viewed: ${userId}/${docType} by ${caller.id}`);
    return { downloadUrl };
  }

  async listDocuments(userId: string, caller: JwtUser) {
    await this.assertCanView(caller, userId);
    const docs = await this.repository.listByUser(userId);
    return docs.map((d) => ({ docType: d.docType, contentType: d.contentType, uploadedAt: d.uploadedAt }));
  }

  async delete(userId: string, docType: DocumentType, caller: JwtUser): Promise<void> {
    await this.assertAdmin(caller);
    const doc = await this.repository.getByType(userId, docType);
    if (!doc) throw new NotFoundException('Document not found');

    await this.s3.deleteObject(doc.s3Key);
    await this.repository.delete(userId, docType);
    await this.writeAudit(userId, caller.id, 'document.deleted', docType);
    this.publish('document.deleted', { technicianId: userId, docType, actorId: caller.id });
    this.logger.log(`Document deleted: ${userId}/${docType} by ${caller.id}`);
  }

  // --- helpers ---

  private async writeAudit(
    userId: string,
    actorId: string,
    action: string,
    resource: string,
  ): Promise<void> {
    await this.audit
      .record({ userId, actorId, action, resource, timestamp: new Date().toISOString() })
      .catch((err) => this.logger.error(`Failed to write audit record: ${err.message}`));
  }

  private async assertCanView(caller: JwtUser, userId: string): Promise<void> {
    if (caller.id === userId) return;
    if (await this.isPrivileged(caller)) return;
    throw new ForbiddenException('You can only access your own documents');
  }

  private async assertAdmin(caller: JwtUser): Promise<void> {
    if (!(await this.isAdmin(caller))) {
      throw new ForbiddenException('Only an administrator can delete documents');
    }
  }

  private async isPrivileged(caller: JwtUser): Promise<boolean> {
    if (!caller.roleId) throw new ForbiddenException('User has no roleId assigned');
    const role = await this.rolesService.findById(caller.roleId);
    if (role.isSystem && role.name === 'Super Admin') return true;
    const tech = await this.rolesService.findById(TECHNICIAN_ROLE_ID);
    return role.priority > tech.priority;
  }

  private async isAdmin(caller: JwtUser): Promise<boolean> {
    if (!caller.roleId) throw new ForbiddenException('User has no roleId assigned');
    const role = await this.rolesService.findById(caller.roleId);
    if (role.isSystem && role.name === 'Super Admin') return true;
    const admin = await this.rolesService.findById(ADMIN_ROLE_ID);
    return role.priority >= admin.priority;
  }

  private publish(eventType: string, payload: Record<string, unknown>): void {
    if (!this.snsPublisher) return;
    this.snsPublisher
      .publish(USER_EVENTS_TOPIC, eventType, payload)
      .catch((err) => this.logger.warn(`Failed to publish ${eventType}: ${err.message}`));
  }
}

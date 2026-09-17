import {
  BadRequestException,
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
import { type AuditEntryWithActor } from './audit.types';
import { RolesService } from '../../roles/roles.service';
import { UsersRepository } from '../../users/users.repository';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { PHOTO_CONTENT_TYPE } from './dto/upload-photo.dto';
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
    private readonly usersRepository: UsersRepository,
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
    return this.presignUpload(userId, dto.docType, dto.contentType, caller);
  }

  private async presignUpload(
    userId: string,
    docType: DocumentType,
    contentType: string,
    caller: JwtUser,
  ): Promise<{ uploadUrl: string; s3Key: string; headers: Record<string, string> }> {
    const s3Key = documentS3Key(userId, docType);
    // The SSE-KMS headers are part of the signature — the client MUST send them
    // back on the PUT, so hand them over rather than leaving the browser to
    // guess (and 403).
    const { url: uploadUrl, headers } = await this.s3.getPresignedUpload(s3Key, {
      contentType,
      kmsKeyId: process.env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents',
    });

    const now = new Date().toISOString();
    await this.repository.upsert({
      userId,
      docType,
      s3Key,
      contentType,
      uploadedBy: caller.id,
      uploadedAt: now,
    });

    await this.writeAudit(userId, caller.id, 'document.uploaded', docType);
    this.publish('document.uploaded', { technicianId: userId, docType });
    this.logger.log(`Document upload requested: ${userId}/${docType} by ${caller.id}`);
    return { uploadUrl, s3Key, headers };
  }

  /**
   * The card's photo is the one document a manager puts up for someone else:
   * an avatar is not a licence or a bank letter. It is stored as the
   * `profile_photo` document — same bucket, same key, same audit row — so the
   * Documents tab still lists it and the profile can link to it; only who may
   * write it differs from `requestUpload`.
   */
  async requestPhotoUpload(
    userId: string,
    contentType: string,
    caller: JwtUser,
  ): Promise<{ uploadUrl: string; s3Key: string; headers: Record<string, string> }> {
    await this.assertCanEditCard(caller, userId);
    if (!PHOTO_CONTENT_TYPE.test(contentType)) {
      throw new BadRequestException('A profile photo must be a JPEG, PNG or WebP image');
    }
    return this.presignUpload(userId, 'profile_photo', contentType, caller);
  }

  /** Takes the photo off the card: the object, the record, and an audit row. */
  async deletePhoto(userId: string, caller: JwtUser): Promise<void> {
    await this.assertCanEditCard(caller, userId);
    await this.removeDocument(userId, 'profile_photo', caller);
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
    await this.removeDocument(userId, docType, caller);
  }

  private async removeDocument(userId: string, docType: DocumentType, caller: JwtUser): Promise<void> {
    const doc = await this.repository.getByType(userId, docType);
    if (!doc) throw new NotFoundException('Document not found');

    await this.s3.deleteObject(doc.s3Key);
    await this.repository.delete(userId, docType);
    await this.writeAudit(userId, caller.id, 'document.deleted', docType);
    this.publish('document.deleted', { technicianId: userId, docType, actorId: caller.id });
    this.logger.log(`Document deleted: ${userId}/${docType} by ${caller.id}`);
  }

  async getAuditTrail(userId: string): Promise<AuditEntryWithActor[]> {
    const entries = await this.audit.listByUser(userId);
    const actorIds = [
      ...new Set(entries.map((e) => e.actorId).filter((id): id is string => Boolean(id))),
    ];
    const actors = await Promise.all(
      actorIds.map((id) => this.usersRepository.findById(id).catch(() => null)),
    );
    const names = new Map<string, string>();
    actorIds.forEach((id, i) => {
      const actor = actors[i];
      if (!actor) return;
      const name = `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim();
      names.set(id, name || actor.email);
    });
    return entries.map((e) => ({ ...e, actorName: names.get(e.actorId) }));
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

  /** The card is the person's own, or a manager's to fill in. */
  private async assertCanEditCard(caller: JwtUser, userId: string): Promise<void> {
    if (caller.id === userId) return;
    if (await this.isPrivileged(caller)) return;
    throw new ForbiddenException("You can only change your own card's photo");
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

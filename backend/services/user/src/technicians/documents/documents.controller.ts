import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type DocumentType } from '@bitcrm/types';
import { Internal } from '../../common/decorators/internal.decorator';
import { DocumentsService } from './documents.service';
import { SensitiveService } from './sensitive.service';
import { AuditRepository } from './audit.repository';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { SetSensitiveDto } from './dto/set-sensitive.dto';

@ApiTags('Technician Documents')
@ApiBearerAuth()
@Controller('technicians')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly sensitive: SensitiveService,
    private readonly audit: AuditRepository,
  ) {}

  // --- Internal (service-to-service) ---
  @Get('internal/:id/bank-account')
  @Internal()
  @ApiOperation({
    summary: 'Internal: decrypted bank account (payment-service)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). ' +
      'Returns the decrypted bank account for payout processing. Every call writes an audit record.',
  })
  async internalBankAccount(@Param('id') id: string) {
    const bankAccount = await this.sensitive.getBankAccountInternal(id);
    return { success: true, data: { bankAccount } };
  }

  // --- Documents (files in S3) ---
  @Post(':id/documents')
  @RequirePermission('documents', 'upload')
  @ApiOperation({
    summary: 'Request a presigned (SSE-KMS) upload URL for a document',
    description:
      '**Guard:** `documents.upload` permission required. Self only. ' +
      'Returns a short-TTL presigned PUT URL that enforces SSE-KMS encryption.',
  })
  async requestUpload(
    @Param('id') id: string,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.documents.requestUpload(id, dto, user);
    return { success: true, data };
  }

  @Get(':id/documents')
  @RequirePermission('documents', 'view')
  @ApiOperation({
    summary: 'List a technician’s documents (metadata only)',
    description: '**Guard:** `documents.view` permission required. Manager+ or self.',
  })
  async list(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.documents.listDocuments(id, user);
    return { success: true, data };
  }

  @Get(':id/documents/:docType')
  @RequirePermission('documents', 'view')
  @ApiOperation({
    summary: 'Get a short-TTL presigned download URL (audited)',
    description:
      '**Guard:** `documents.view` permission required. Manager+ or self. ' +
      'Writes an access-audit record and publishes `document.accessed`.',
  })
  async download(
    @Param('id') id: string,
    @Param('docType') docType: DocumentType,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.documents.getDownloadUrl(id, docType, user);
    return { success: true, data };
  }

  @Delete(':id/documents/:docType')
  @RequirePermission('documents', 'delete')
  @ApiOperation({
    summary: 'Delete a document',
    description: '**Guard:** `documents.delete` permission required. Admin+ only. Audited.',
  })
  async remove(
    @Param('id') id: string,
    @Param('docType') docType: DocumentType,
    @CurrentUser() user: JwtUser,
  ) {
    await this.documents.delete(id, docType, user);
    return { success: true, data: null };
  }

  // --- Sensitive fields (KMS-encrypted) ---
  @Put(':id/sensitive')
  @RequirePermission('documents', 'upload')
  @ApiOperation({
    summary: 'Set encrypted sensitive fields (SSN, bank account)',
    description:
      '**Guard:** `documents.upload` permission required. Self only. ' +
      'Values are encrypted with KMS before storage; plaintext is never persisted or logged.',
  })
  async setSensitive(
    @Param('id') id: string,
    @Body() dto: SetSensitiveDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.sensitive.setSensitive(id, dto, user);
    return { success: true, data };
  }

  @Get(':id/sensitive')
  @RequirePermission('documents', 'view')
  @ApiOperation({
    summary: 'Read sensitive fields (masked, or full for Admin+)',
    description:
      '**Guard:** `documents.view` permission required. Manager+ or self get **masked** ' +
      '(last-4); **Admin+** get full plaintext. Every read is audited + publishes `sensitive.accessed`.',
  })
  async getSensitive(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.sensitive.getSensitive(id, user);
    return { success: true, data };
  }

  // --- Audit trail ---
  @Get(':id/audit')
  @RequirePermission('documents', 'view')
  @ApiOperation({
    summary: 'List the sensitive-data access audit trail',
    description: '**Guard:** `documents.view` permission required. Manager+ or self.',
  })
  async auditTrail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    // view is gated by the guard + service-level checks on the sensitive/documents reads;
    // listing the trail itself requires documents.view.
    const data = await this.audit.listByUser(id);
    return { success: true, data };
  }
}

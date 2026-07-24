import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type CompanyDocumentType, type JwtUser } from '@bitcrm/types';
import { CompanyDocumentsService } from './company-documents.service';
import { UploadCompanyDocumentDto } from './dto/upload-company-document.dto';

/** W-9 / COI compliance documents for a company. Gated by `companies` perms. */
@ApiTags('Company Documents')
@ApiBearerAuth()
@Controller('companies')
export class CompanyDocumentsController {
  constructor(private readonly service: CompanyDocumentsService) {}

  @Post(':id/documents')
  @RequirePermission('companies', 'edit')
  @ApiOperation({
    summary: 'Request a presigned (SSE-KMS) upload URL for a compliance document',
    description: '**Guard:** `companies.edit`. The returned headers must be replayed on the PUT.',
  })
  async requestUpload(
    @Param('id') id: string,
    @Body() dto: UploadCompanyDocumentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.requestUpload(id, dto, user);
    return { success: true, data };
  }

  @Get(':id/documents')
  @RequirePermission('companies', 'view')
  @ApiOperation({ summary: 'List a company’s compliance documents (metadata)', description: '**Guard:** `companies.view`.' })
  async list(@Param('id') id: string) {
    const data = await this.service.list(id);
    return { success: true, data };
  }

  @Get(':id/documents/:docType')
  @RequirePermission('companies', 'view')
  @ApiOperation({ summary: 'Get a short-TTL presigned download URL', description: '**Guard:** `companies.view`.' })
  async download(@Param('id') id: string, @Param('docType') docType: CompanyDocumentType) {
    const data = await this.service.getDownloadUrl(id, docType);
    return { success: true, data };
  }

  @Delete(':id/documents/:docType')
  @RequirePermission('companies', 'edit')
  @ApiOperation({ summary: 'Delete a compliance document', description: '**Guard:** `companies.edit`.' })
  async remove(@Param('id') id: string, @Param('docType') docType: CompanyDocumentType) {
    await this.service.delete(id, docType);
    return { success: true, data: null };
  }
}

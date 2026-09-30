import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import type { JwtUser } from '@bitcrm/types';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';

@ApiTags('Template assets')
@ApiBearerAuth()
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @RequirePermission('document_templates', 'edit')
  @ApiOperation({
    summary: 'Start an image upload',
    description:
      '**Guard:** `document_templates.edit`. PNG/JPEG/WebP ≤ 5 MB. PUT the file to `uploadUrl` with exactly `headers` (SSE-KMS headers are signed).',
  })
  async create(@Body() dto: CreateAssetDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.assets.requestUpload(dto, user) };
  }

  @Get(':id/url')
  @ApiOperation({ summary: 'Short-lived URL of an image', description: '**Guard:** any authenticated user.' })
  async url(@Param('id') id: string) {
    return { success: true, data: await this.assets.getUrl(id) };
  }
}

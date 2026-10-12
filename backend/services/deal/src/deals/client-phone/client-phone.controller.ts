import { Body, Controller, ForbiddenException, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission, hasPermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ResolvedPerms } from '../../common/decorators/resolved-permissions.decorator';
import { ChangeClientPhoneDto } from './dto/change-client-phone.dto';
import { ClientPhoneService } from './client-phone.service';

@ApiTags('Deals')
@ApiBearerAuth()
@Controller()
export class ClientPhoneController {
  constructor(private readonly clientPhone: ClientPhoneService) {}

  @Put(':id/client-phone')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Change the first number on a job — this job, the profile, or its open jobs too',
    description:
      '**Guard:** `deals.edit` + `contacts.view_numbers`; `contacts.edit` as well for `client` / `open_jobs`. ' +
      'The job side of the job page\'s "Apply these changes to…": `job` gives this job the number as its own ' +
      '(`clientPhone`); `client` and `open_jobs` make this job follow the profile and pin the OLD profile number ' +
      '(read from crm here) onto the client\'s other jobs that showed it — except, for `open_jobs`, the open and ' +
      'unpaid ones, which take the new number. A job with a number of its own keeps it. The profile itself is ' +
      'written by the caller with crm\'s `PUT /contacts/:id`, after this call.',
  })
  async change(
    @Param('id') id: string,
    @Body() dto: ChangeClientPhoneDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    if (!hasPermission(perms, 'contacts', 'view_numbers')) {
      throw new ForbiddenException("You cannot see this client's numbers");
    }
    if (dto.scope !== 'job' && !hasPermission(perms, 'contacts', 'edit')) {
      throw new ForbiddenException('You cannot change the client profile');
    }
    const data = await this.clientPhone.change(id, { phone: dto.phone, scope: dto.scope }, user);
    return { success: true, data };
  }
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Either a job or a client (Workiz): with `dealId` the estimate is the job's
 * (number `<jobNumber>-<n>`, tax/discount start as the job's); with only
 * `contactId` it is the client's, with no job (a "stub", numbered from the
 * account counter). One of the two is required.
 */
export class CreateEstimateDto {
  @ApiPropertyOptional({ example: 'deal-uuid', description: 'The job. Omit for a client estimate.' })
  @ValidateIf((o: CreateEstimateDto) => !o.contactId || o.dealId !== undefined)
  @IsString()
  @MaxLength(120)
  dealId?: string;

  @ApiPropertyOptional({ example: 'contact-uuid', description: 'The client, for an estimate with no job.' })
  @ValidateIf((o: CreateEstimateDto) => !o.dealId || o.contactId !== undefined)
  @IsString()
  @MaxLength(120)
  contactId?: string;

  @ApiPropertyOptional({ example: 'Good', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: "Start with a copy of the job's current items (job estimates only)." })
  @IsOptional()
  @IsBoolean()
  copyJobItems?: boolean;
}

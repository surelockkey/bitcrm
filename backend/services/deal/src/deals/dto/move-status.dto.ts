import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobSuperStatus } from '@bitcrm/types';

/**
 * Moving a deal's status = setting its fixed super-status, plus optionally a
 * custom sub-status filed under that super-status. Omitting `subStatusId` clears
 * any existing sub-status (e.g. when moving to a bare super-status).
 */
export class MoveStatusDto {
  @ApiProperty({ enum: JobSuperStatus, example: JobSuperStatus.IN_PROGRESS })
  @IsEnum(JobSuperStatus)
  superStatus!: JobSuperStatus;

  @ApiPropertyOptional({
    example: 'a3f2c1b4-8e7d-4a91-9c2e-1f6d0b5a7e34',
    description: 'Catalog sub-status id; must belong to the target super-status. Omit to clear.',
  })
  @IsOptional()
  @IsString()
  subStatusId?: string;

  @ApiPropertyOptional({ example: 'Customer resolved the issue themselves' })
  @IsOptional()
  @IsString()
  cancellationReason?: string;
}

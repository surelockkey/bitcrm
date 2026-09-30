import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { InventoryStatus } from '@bitcrm/types';

export class UpdateContainerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Department the van belongs to' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @ApiPropertyOptional({ enum: InventoryStatus })
  @IsOptional()
  @IsEnum(InventoryStatus)
  status?: InventoryStatus;

  /** A technician id to (re)assign, or null to unassign. */
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Legacy single-technician link; null unassigns. No longer exclusive — who works from ' +
      'the van is `PUT /user-containers/:userId`.',
  })
  @IsOptional()
  @IsString()
  technicianId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  technicianName?: string | null;

  /** A template id to compare the van against, or null to clear it. */
  @ApiPropertyOptional({
    nullable: true,
    description: 'Container template (ideal loadout); must exist and be active. null clears it.',
  })
  @IsOptional()
  @IsString()
  templateId?: string | null;
}

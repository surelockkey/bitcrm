import { IsString, IsOptional, IsObject, IsArray, IsNumber, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { type PermissionMatrix, type DataScopeRules } from '@bitcrm/types';

export class UpdateRoleDto {
  @ApiPropertyOptional({
    example: 'Senior Technician',
    description: 'New role name (must be unique)',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    example: 'Updated description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Full or partial permission matrix update. Replaces the entire matrix.',
    example: {
      deals: { view: true, create: true, edit: true, delete: true },
      contacts: { view: true, create: true, edit: true, delete: false },
    },
  })
  @IsObject()
  @IsOptional()
  permissions?: PermissionMatrix;

  @ApiPropertyOptional({
    description: 'Data scope update. Replaces the entire dataScope map.',
    example: { deals: 'all', contacts: 'department' },
  })
  @IsObject()
  @IsOptional()
  dataScope?: DataScopeRules;

  @ApiPropertyOptional({
    description: 'Stage transition rules update. Replaces the entire array.',
    example: ['*->*'],
  })
  @IsArray()
  @IsOptional()
  dealStageTransitions?: string[];

  @ApiPropertyOptional({
    example: 40,
    description: 'New priority level',
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  priority?: number;
}

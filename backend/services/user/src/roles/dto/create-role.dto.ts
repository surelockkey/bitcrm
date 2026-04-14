import { IsString, IsOptional, IsObject, IsArray, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { type PermissionMatrix, type DataScopeRules } from '@bitcrm/types';

export class CreateRoleDto {
  @ApiProperty({
    example: 'Senior Technician',
    description: 'Unique role name',
  })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    example: 'Technician with extra access for senior team members',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Permission matrix: resource → action → boolean. Deny-by-default — only true values grant access.',
    example: {
      deals: { view: true, create: true, edit: true, delete: false },
      contacts: { view: true, create: true, edit: false, delete: false },
      reports: { view: true, create: false, edit: false, delete: false },
    },
  })
  @IsObject()
  permissions!: PermissionMatrix;

  @ApiProperty({
    description: 'Data visibility scope per resource: "all" | "department" | "assigned_only"',
    example: {
      deals: 'department',
      contacts: 'department',
      reports: 'department',
    },
  })
  @IsObject()
  dataScope!: DataScopeRules;

  @ApiProperty({
    description: 'Allowed deal stage transitions. Supports wildcards: "*->canceled", "*->*"',
    example: ['assigned->en_route', 'en_route->completed', '*->canceled'],
  })
  @IsArray()
  dealStageTransitions!: string[];

  @ApiProperty({
    description: 'Role hierarchy priority (higher = more powerful). Must be < 100 (Super Admin).',
    example: 35,
  })
  @IsNumber()
  @Min(1)
  priority!: number;
}

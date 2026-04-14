import { IsObject, IsOptional, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { type PermissionMatrix, type DataScopeRules } from '@bitcrm/types';

export class SetPermissionOverridesDto {
  @ApiPropertyOptional({
    description: 'Sparse permission overrides — only include resource.action pairs that differ from the role base. User overrides win on conflict.',
    example: {
      deals: { delete: true },
      reports: { view: true, create: true },
    },
  })
  @IsObject()
  @IsOptional()
  permissions?: PermissionMatrix;

  @ApiPropertyOptional({
    description: 'Sparse data scope overrides — only include resources that differ from the role base.',
    example: { deals: 'all' },
  })
  @IsObject()
  @IsOptional()
  dataScope?: DataScopeRules;

  @ApiPropertyOptional({
    description: 'If set, fully replaces the role\'s stage transition rules for this user.',
    example: ['*->*'],
  })
  @IsArray()
  @IsOptional()
  dealStageTransitions?: string[];
}

import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@bitcrm/types';

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    example: 'role-technician',
    description: 'Filter by roleId',
  })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional({ example: 'HVAC' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    example: 'smith',
    description:
      'Search the whole directory: every word must appear in the name, email, department or phone. ' +
      'Combines with the other filters; the matches are sorted by name and paged by `cursor`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

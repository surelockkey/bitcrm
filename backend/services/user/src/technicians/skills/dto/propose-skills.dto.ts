import { IsArray, IsString, IsOptional, ArrayUnique } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ProposeSkillsDto {
  @ApiPropertyOptional({
    type: [String],
    example: ['Locksmith', 'Rekeying'],
    description: 'Job types the technician can perform.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  jobTypes?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Atlanta', 'North Georgia'],
    description: 'Metro service areas the technician can cover.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  serviceAreas?: string[];
}

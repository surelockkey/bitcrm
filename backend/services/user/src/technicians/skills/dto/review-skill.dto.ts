import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewSkillDto {
  @ApiPropertyOptional({
    example: 'Certification verified',
    description: 'Reviewer comment. Required when rejecting a skill.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comments?: string;
}

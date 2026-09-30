import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { AUTOMATION_NAME_MAX_LENGTH } from '../automations.constants';

/** `POST /automations/:id/duplicate` — the only thing a copy may be told. */
export class DuplicateAutomationDto {
  @ApiPropertyOptional({
    example: 'Job canceled — notify the techs (Bronx)',
    description: 'Name for the copy. Left out, it is the original\'s name with "(copy)" — "(copy 2)" if that is taken.',
  })
  @IsOptional()
  @IsString()
  @Length(1, AUTOMATION_NAME_MAX_LENGTH)
  name?: string;
}

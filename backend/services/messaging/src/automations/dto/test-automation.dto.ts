import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** `POST /automations/:id/test` — the job to try the rule against. */
export class TestAutomationDto {
  @ApiProperty({ description: 'Job id (not the job number) the rule is evaluated against.' })
  @IsString()
  @Length(1, 128)
  dealId!: string;
}

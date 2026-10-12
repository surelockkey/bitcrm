import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CLIENT_PHONE_SCOPES, type ClientPhoneScope } from '@bitcrm/types';

/** The job page's "Apply these changes to…" for a changed first number. */
export class ChangeClientPhoneDto {
  @ApiProperty({ example: '+14045550199', description: 'The new first number; normalized to E.164.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone!: string;

  @ApiProperty({
    enum: CLIENT_PHONE_SCOPES,
    description:
      '`job` — this job only; `client` — this job and the client profile (the other jobs keep the number they ' +
      'had); `open_jobs` — also the open, unpaid jobs that had the old number.',
  })
  @IsIn(CLIENT_PHONE_SCOPES)
  scope!: ClientPhoneScope;
}

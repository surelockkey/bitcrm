import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserContainerAccess } from '@bitcrm/types';

/** `PUT /user-containers/:userId` — the whole assignment, replaced. */
export class AssignUserContainerDto {
  @ApiProperty({ example: 'Mike Ross', description: 'Display name snapshot of the user.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  userName!: string;

  @ApiProperty({ enum: UserContainerAccess })
  @IsEnum(UserContainerAccess)
  access!: UserContainerAccess;

  @ApiPropertyOptional({
    description:
      'Required when `access` is `container` (the container must exist and be active); ' +
      'ignored otherwise.',
  })
  @ValidateIf((o: AssignUserContainerDto) => o.access === UserContainerAccess.CONTAINER)
  @IsString()
  @IsNotEmpty()
  containerId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Workiz `user_limited`: the user may use their own container only. Stored `false` ' +
      'unless `access` is `container`.',
  })
  @IsOptional()
  @IsBoolean()
  limited?: boolean;
}

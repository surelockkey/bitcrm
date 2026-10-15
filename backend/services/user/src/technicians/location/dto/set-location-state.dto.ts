import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LOCATION_PERMISSIONS,
  type LocationPermission,
} from '../technician-location.service';

/** What the phone says about its own location setting. */
export class SetLocationStateDto {
  @ApiProperty({
    enum: LOCATION_PERMISSIONS,
    example: 'denied',
    description:
      'The OS location permission for the app: `granted`, `denied` (the technician said no ' +
      'or switched it off in Settings), or `undetermined` (never asked / not answered yet).',
  })
  @IsIn(LOCATION_PERMISSIONS)
  permission!: LocationPermission;

  @ApiPropertyOptional({
    example: false,
    description: 'False when the phone gives only an approximate position (iOS "Precise Location" off).',
  })
  @IsOptional()
  @IsBoolean()
  precise?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether the app may read the location while in the background ("Always").',
  })
  @IsOptional()
  @IsBoolean()
  background?: boolean;
}

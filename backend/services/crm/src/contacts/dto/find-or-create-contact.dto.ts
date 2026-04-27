import { IsString, IsOptional, MinLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContactSource } from '@bitcrm/types';

export class FindOrCreateContactDto {
  @ApiProperty({ example: '(404) 555-1234' })
  @IsString()
  phone!: string;

  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @ApiPropertyOptional({ enum: ContactSource })
  @IsOptional()
  @IsEnum(ContactSource)
  source?: ContactSource;
}

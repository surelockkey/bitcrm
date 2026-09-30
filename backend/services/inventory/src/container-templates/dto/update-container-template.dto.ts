import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { InventoryStatus } from '@bitcrm/types';
import { ContainerTemplateItemDto, MAX_TEMPLATE_ITEMS } from './create-container-template.dto';

/** Only a value that was sent is validated — and `null` is a value, so it is refused. */
const whenSent = ValidateIf((_: unknown, value: unknown) => value !== undefined);

/**
 * Partial: every field left out is kept. `description: null` clears the
 * description; the other fields refuse `null`.
 */
export class UpdateContainerTemplateDto {
  @ApiPropertyOptional()
  @whenSent
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ type: [ContainerTemplateItemDto], description: 'Replaces every line.' })
  @whenSent
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_TEMPLATE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ContainerTemplateItemDto)
  items?: ContainerTemplateItemDto[];

  @ApiPropertyOptional({
    enum: InventoryStatus,
    description: '`active` brings an archived template back (its name must be free again).',
  })
  @whenSent
  @IsEnum(InventoryStatus)
  status?: InventoryStatus;
}

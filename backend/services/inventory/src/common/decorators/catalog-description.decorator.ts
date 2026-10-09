import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** The longest description a brand or a category keeps. */
export const CATALOG_DESCRIPTION_MAX = 1000;

/**
 * The `description` of a brand or an item category — Workiz's "Description"
 * under the name in its "Edit brand" / "Edit category" popups. Optional,
 * trimmed; `''` clears it.
 */
export function CatalogDescription(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      example: 'ALL ORDERS MADE BY SURE LOCK & KEY',
      description: `Optional, trimmed, up to ${CATALOG_DESCRIPTION_MAX} characters; '' clears it.`,
    }),
    IsOptional(),
    IsString(),
    Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)),
    MaxLength(CATALOG_DESCRIPTION_MAX),
  );
}

/** A catalog row as stored: the shared fields plus the description the import or the API wrote. */
export type WithDescription<T> = T & { description?: string };

import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsString } from "class-validator";

/**
 * Turn ids you already hold into names.
 *
 * Capped, because the cap is what makes "you must already hold the id" true —
 * without it a caller could sweep a generated id space in one request.
 */
export class LookupUserNamesDto {
  @ApiProperty({ type: [String], example: ["c32ebecf-…", "8eec7d68-…"] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  userIds!: string[];
}

import { Transform } from "class-transformer";
import { IsNotEmpty, IsOptional, IsString, IsUUID, ValidateIf } from "class-validator";
import { lowercaseUuid, trimString, trimToNull } from "../../common/trim.ts";

/** Body of POST /api/epics. The team is chosen here and can never be changed afterwards (spec §5). */
export class CreateEpicDto {
  @Transform(lowercaseUuid)
  @IsUUID("all", { message: "teamId must be a valid UUID" })
  teamId!: string;

  @Transform(trimString)
  @IsString({ message: "title must be a string" })
  @IsNotEmpty({ message: "title is required" })
  title!: string;

  /** Optional; trimmed, and a blank value is stored as null. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: "description must be a string" })
  description?: string | null;
}

/**
 * Body of PATCH /api/epics/:id. Every field is optional; `teamId` is not accepted (immutable), so sending it
 * is rejected by the global whitelist validation.
 */
export class UpdateEpicDto {
  /** May be omitted, but if present it must be a non-blank string (null is rejected). */
  @Transform(trimString)
  @ValidateIf((dto: UpdateEpicDto) => dto.title !== undefined)
  @IsString({ message: "title must be a string" })
  @IsNotEmpty({ message: "title is required" })
  title?: string;

  /** null or a blank string clears the description. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: "description must be a string" })
  description?: string | null;
}

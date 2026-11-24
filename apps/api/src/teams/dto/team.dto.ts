import { Transform } from "class-transformer";
import { IsNotEmpty, IsString } from "class-validator";
import { trimString } from "../../common/trim.ts";

/** Body of POST /api/teams and PATCH /api/teams/:id. The name is stored trimmed (spec §4). */
export class TeamNameDto {
  @Transform(trimString)
  @IsString({ message: "name must be a string" })
  @IsNotEmpty({ message: "name is required" })
  name!: string;
}

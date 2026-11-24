import { Transform } from "class-transformer";
import { IsNotEmpty, IsString } from "class-validator";
import { trimString } from "../../common/trim.ts";

/**
 * Body of POST /api/tickets/:id/comments (spec §7). Stored trimmed; blank is rejected. The author and
 * `createdAt` are set by the server, so sending them is rejected by the global whitelist validation.
 */
export class CreateCommentDto {
  @Transform(trimString)
  @IsString({ message: "body must be a string" })
  @IsNotEmpty({ message: "body is required" })
  body!: string;
}

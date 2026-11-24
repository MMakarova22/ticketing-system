import { Transform } from "class-transformer";
import { IsEnum, IsNotEmpty, IsString, IsUUID, ValidateIf } from "class-validator";
import { lowercaseUuid, trimString } from "../../common/trim.ts";
import { TicketState, TicketType } from "../../generated/prisma/enums.ts";

const TYPE_MESSAGE = `type must be one of: ${Object.values(TicketType).join(", ")}`;
const STATE_MESSAGE = `state must be one of: ${Object.values(TicketState).join(", ")}`;

/** True when the field was sent (null counts as sent, so validators reject it). */
const sent =
  (key: string) =>
  (dto: object): boolean =>
    (dto as Record<string, unknown>)[key] !== undefined;

/** True when an optional epic reference was sent as a value other than null. */
const epicSent = (dto: { epicId?: string | null }): boolean => dto.epicId !== undefined && dto.epicId !== null;

/**
 * Body of POST /api/tickets (spec §6). `createdById`, `createdAt`, `modifiedAt` and `id` are set by the server;
 * sending them is rejected by the global whitelist validation. Title and body are stored trimmed, and a body that
 * is only whitespace is rejected (D8).
 */
export class CreateTicketDto {
  @Transform(lowercaseUuid)
  @IsUUID("all", { message: "teamId must be a valid UUID" })
  teamId!: string;

  /** Optional; null or omitted means "no epic". Must be an epic of the same team (checked by the service). */
  @Transform(lowercaseUuid)
  @ValidateIf(epicSent)
  @IsUUID("all", { message: "epicId must be a valid UUID or null" })
  epicId?: string | null;

  @IsEnum(TicketType, { message: TYPE_MESSAGE })
  type!: TicketType;

  /** Optional; new tickets start in `new`. */
  @ValidateIf(sent("state"))
  @IsEnum(TicketState, { message: STATE_MESSAGE })
  state?: TicketState;

  @Transform(trimString)
  @IsString({ message: "title must be a string" })
  @IsNotEmpty({ message: "title is required" })
  title!: string;

  @Transform(trimString)
  @IsString({ message: "body must be a string" })
  @IsNotEmpty({ message: "body is required" })
  body!: string;
}

/**
 * Body of PATCH /api/tickets/:id. Every field is optional, but a field that is present must be valid; only
 * `epicId` accepts null (clears the epic). Drag-and-drop on the board sends `{ state }`.
 */
export class UpdateTicketDto {
  @Transform(lowercaseUuid)
  @ValidateIf(sent("teamId"))
  @IsUUID("all", { message: "teamId must be a valid UUID" })
  teamId?: string;

  @Transform(lowercaseUuid)
  @ValidateIf(epicSent)
  @IsUUID("all", { message: "epicId must be a valid UUID or null" })
  epicId?: string | null;

  @ValidateIf(sent("type"))
  @IsEnum(TicketType, { message: TYPE_MESSAGE })
  type?: TicketType;

  @ValidateIf(sent("state"))
  @IsEnum(TicketState, { message: STATE_MESSAGE })
  state?: TicketState;

  @Transform(trimString)
  @ValidateIf(sent("title"))
  @IsString({ message: "title must be a string" })
  @IsNotEmpty({ message: "title is required" })
  title?: string;

  @Transform(trimString)
  @ValidateIf(sent("body"))
  @IsString({ message: "body must be a string" })
  @IsNotEmpty({ message: "body is required" })
  body?: string;
}

import { Transform } from "class-transformer";
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

/** Emails are trimmed and lower-cased before validation, storage and comparison (spec §3). */
const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export class EmailDto {
  @Transform(normalizeEmail)
  @IsString({ message: "email must be a string" })
  @IsEmail({}, { message: "email must be a valid email address" })
  email!: string;
}

/**
 * Body of POST /api/auth/register: the email only (review M1). The password is chosen on the verification step by
 * whoever controls the mailbox; a `password` field here is rejected (400) by the global whitelist validation.
 */
export class RegisterDto extends EmailDto {}

export class LoginDto extends EmailDto {
  @IsString({ message: "password must be a string" })
  @IsNotEmpty({ message: "password is required" })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: `password must be at most ${PASSWORD_MAX_LENGTH} characters` })
  password!: string;
}

/** Body of POST /api/auth/verify-email: the emailed token and the account's new password (review M1). */
export class VerifyEmailDto {
  @IsString({ message: "token must be a string" })
  @IsNotEmpty({ message: "token is required" })
  @MaxLength(256, { message: "token is invalid" })
  token!: string;

  /** Never trimmed or otherwise modified. */
  @IsString({ message: "password must be a string" })
  @MinLength(PASSWORD_MIN_LENGTH, { message: `password must be at least ${PASSWORD_MIN_LENGTH} characters` })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: `password must be at most ${PASSWORD_MAX_LENGTH} characters` })
  password!: string;
}

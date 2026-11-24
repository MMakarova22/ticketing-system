import { BadRequestException, type PipeTransform } from "@nestjs/common";
import { isUUID } from "class-validator";

/**
 * Validates a UUID route/query parameter and returns it lower-cased (review L1): PostgreSQL returns UUIDs in lower
 * case, so services can compare ids as strings. Malformed values become 400 VALIDATION_ERROR.
 */
export function uuidPipe(name: string): PipeTransform<unknown, string> {
  return {
    transform(value: unknown): string {
      if (typeof value !== "string" || !isUUID(value)) {
        throw new BadRequestException({ message: `${name} must be a valid UUID`, code: "VALIDATION_ERROR" });
      }
      return value.toLowerCase();
    },
  };
}

import { BadRequestException, type ValidationError, ValidationPipe } from "@nestjs/common";

function flatten(errors: ValidationError[], prefix = ""): string[] {
  return errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {});
    return [...own, ...flatten(error.children ?? [], path)];
  });
}

/** Global DTO validation: unknown fields are rejected and every problem is reported as one 400 message. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({ message: flatten(errors).join("; ") || "Validation failed", code: "VALIDATION_ERROR" }),
  });
}

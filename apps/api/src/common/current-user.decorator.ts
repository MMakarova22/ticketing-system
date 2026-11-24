import { createParamDecorator, type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { AuthenticatedRequest, AuthUser } from "./authenticated-request.ts";

/** Injects the authenticated user. Only valid on routes protected by AuthGuard (i.e. not @Public()). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) {
    throw new UnauthorizedException("Authentication required");
  }
  return user;
});

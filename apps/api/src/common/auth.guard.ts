import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SessionService } from "../auth/session.service.ts";
import type { AuthenticatedRequest } from "./authenticated-request.ts";
import { IS_PUBLIC_KEY } from "./public.decorator.ts";

/**
 * Global guard: every route requires a valid session unless it is marked @Public().
 * Expired sessions are deleted and rejected; unverified users are rejected (defense in depth).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const resolved = await this.sessions.resolve(req);
    if (!resolved) {
      throw new UnauthorizedException("Authentication required");
    }
    req.user = resolved.user;
    req.sessionId = resolved.sessionId;
    return true;
  }
}

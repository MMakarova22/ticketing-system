import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "../common/auth.guard.ts";
import { MailModule } from "../mail/mail.module.ts";
import { AuthRateLimitService } from "./auth-rate-limit.service.ts";
import { AuthController } from "./auth.controller.ts";
import { AuthService } from "./auth.service.ts";
import { SessionService } from "./session.service.ts";

/** Registration, email verification, login/logout and the global session guard. */
@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [AuthService, SessionService, AuthRateLimitService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [SessionService],
})
export class AuthModule {}

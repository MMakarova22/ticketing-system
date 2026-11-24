import { type DynamicModule, Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.ts";
import { CommentsModule } from "./comments/comments.module.ts";
import { type AppConfig, AppConfigModule } from "./config/app-config.ts";
import { EpicsModule } from "./epics/epics.module.ts";
import { HealthController } from "./health/health.controller.ts";
import { PrismaModule } from "./prisma/prisma.module.ts";
import { TeamsModule } from "./teams/teams.module.ts";
import { TicketsModule } from "./tickets/tickets.module.ts";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        PrismaModule,
        AuthModule,
        TeamsModule,
        EpicsModule,
        TicketsModule,
        CommentsModule,
      ],
      controllers: [HealthController],
    };
  }
}

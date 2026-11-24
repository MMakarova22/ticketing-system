import { Module } from "@nestjs/common";
import { TeamsController } from "./teams.controller.ts";
import { TeamsService } from "./teams.service.ts";

/** Team management (spec §4). */
@Module({
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}

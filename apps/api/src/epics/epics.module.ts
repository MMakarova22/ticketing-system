import { Module } from "@nestjs/common";
import { EpicsController } from "./epics.controller.ts";
import { EpicsService } from "./epics.service.ts";

/** Epic management (spec §5). */
@Module({
  controllers: [EpicsController],
  providers: [EpicsService],
})
export class EpicsModule {}

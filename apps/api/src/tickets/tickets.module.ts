import { Module } from "@nestjs/common";
import { TicketsController } from "./tickets.controller.ts";
import { TicketsService } from "./tickets.service.ts";

/** Ticket CRUD (spec §6). */
@Module({
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}

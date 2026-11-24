import { Module } from "@nestjs/common";
import { CommentsController } from "./comments.controller.ts";
import { CommentsService } from "./comments.service.ts";

/** Ticket comments (spec §7). */
@Module({
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}

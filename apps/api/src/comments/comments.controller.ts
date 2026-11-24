import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { AuthUser } from "../common/authenticated-request.ts";
import { CurrentUser } from "../common/current-user.decorator.ts";
import { uuidPipe } from "../common/uuid.pipe.ts";
import type { CommentView } from "./comment.view.ts";
import { CommentsService } from "./comments.service.ts";
import { CreateCommentDto } from "./dto/comment.dto.ts";

/** Comments of a ticket. Immutable: there are intentionally no PATCH or DELETE routes (spec §7). */
@Controller("tickets/:id/comments")
export class CommentsController {
  constructor(@Inject(CommentsService) private readonly comments: CommentsService) {}

  @Get()
  list(@Param("id", uuidPipe("id")) ticketId: string): Promise<CommentView[]> {
    return this.comments.list(ticketId);
  }

  @Post()
  create(
    @Param("id", uuidPipe("id")) ticketId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentView> {
    return this.comments.create(ticketId, user.id, dto.body);
  }
}

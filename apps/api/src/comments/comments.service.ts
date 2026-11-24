import { Inject, Injectable } from "@nestjs/common";
import { isForeignKeyViolation } from "../common/prisma-errors.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { ticketNotFound } from "../tickets/tickets.service.ts";
import { COMMENT_SELECT, type CommentView, toCommentView } from "./comment.view.ts";

/**
 * Comments are immutable (spec §7): there is no update or delete. They are removed only together with their
 * ticket (ON DELETE CASCADE).
 */
@Injectable()
export class CommentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Comments of a ticket, oldest first. 404 if the ticket does not exist. */
  async list(ticketId: string): Promise<CommentView[]> {
    await this.assertTicketExists(ticketId);
    const rows = await this.prisma.comment.findMany({
      where: { ticketId },
      select: COMMENT_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toCommentView);
  }

  async create(ticketId: string, authorId: string, body: string): Promise<CommentView> {
    await this.assertTicketExists(ticketId);
    try {
      // Written to the Comment table only. Never create comments through a nested `ticket.update`: that would
      // advance the ticket's @updatedAt, and adding a comment must not change the ticket's modifiedAt (D7).
      const row = await this.prisma.comment.create({ data: { ticketId, authorId, body }, select: COMMENT_SELECT });
      return toCommentView(row);
    } catch (error) {
      // The ticket was deleted after the check.
      if (isForeignKeyViolation(error)) {
        throw ticketNotFound();
      }
      throw error;
    }
  }

  private async assertTicketExists(ticketId: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
    if (!ticket) {
      throw ticketNotFound();
    }
  }
}

/** Columns read for every comment response. */
export const COMMENT_SELECT = {
  id: true,
  ticketId: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, email: true } },
} as const;

interface CommentRow {
  id: string;
  ticketId: string;
  body: string;
  createdAt: Date;
  author: { id: string; email: string };
}

export interface CommentView {
  id: string;
  ticketId: string;
  body: string;
  author: { id: string; email: string };
  createdAt: string;
}

export function toCommentView(row: CommentRow): CommentView {
  return {
    id: row.id,
    ticketId: row.ticketId,
    body: row.body,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
  };
}

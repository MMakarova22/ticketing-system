import type { TicketState, TicketType } from "../generated/prisma/enums.ts";

/** Columns read for every ticket response (list and detail share one shape). */
export const TICKET_SELECT = {
  id: true,
  teamId: true,
  epicId: true,
  type: true,
  state: true,
  title: true,
  body: true,
  createdAt: true,
  modifiedAt: true,
  epic: { select: { id: true, title: true } },
  createdBy: { select: { id: true, email: true } },
  _count: { select: { comments: true } },
} as const;

interface TicketRow {
  id: string;
  teamId: string;
  epicId: string | null;
  type: TicketType;
  state: TicketState;
  title: string;
  body: string;
  createdAt: Date;
  modifiedAt: Date;
  epic: { id: string; title: string } | null;
  createdBy: { id: string; email: string };
  _count: { comments: number };
}

export interface TicketView {
  id: string;
  teamId: string;
  epicId: string | null;
  epic: { id: string; title: string } | null;
  type: TicketType;
  state: TicketState;
  title: string;
  body: string;
  createdBy: { id: string; email: string };
  createdAt: string;
  modifiedAt: string;
  commentCount: number;
}

export function toTicketView(row: TicketRow): TicketView {
  return {
    id: row.id,
    teamId: row.teamId,
    epicId: row.epicId,
    epic: row.epic,
    type: row.type,
    state: row.state,
    title: row.title,
    body: row.body,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    modifiedAt: row.modifiedAt.toISOString(),
    commentCount: row._count.comments,
  };
}

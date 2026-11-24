/** Columns read for every epic response, including the ticket count shown on the Epics screen. */
export const EPIC_SELECT = {
  id: true,
  teamId: true,
  title: true,
  description: true,
  createdAt: true,
  modifiedAt: true,
  _count: { select: { tickets: true } },
} as const;

interface EpicRow {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  createdAt: Date;
  modifiedAt: Date;
  _count: { tickets: number };
}

export interface EpicView {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  createdAt: string;
  modifiedAt: string;
  ticketCount: number;
}

export function toEpicView(row: EpicRow): EpicView {
  return {
    id: row.id,
    teamId: row.teamId,
    title: row.title,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    modifiedAt: row.modifiedAt.toISOString(),
    ticketCount: row._count.tickets,
  };
}

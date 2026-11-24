/** Columns read for every team response, including the counts shown on the Teams screen. */
export const TEAM_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  modifiedAt: true,
  _count: { select: { epics: true, tickets: true } },
} as const;

interface TeamRow {
  id: string;
  name: string;
  createdAt: Date;
  modifiedAt: Date;
  _count: { epics: number; tickets: number };
}

export interface TeamView {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  ticketCount: number;
  epicCount: number;
}

export function toTeamView(row: TeamRow): TeamView {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    modifiedAt: row.modifiedAt.toISOString(),
    ticketCount: row._count.tickets,
    epicCount: row._count.epics,
  };
}

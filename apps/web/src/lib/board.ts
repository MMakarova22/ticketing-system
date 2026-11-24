import { TICKET_STATES, TICKET_TYPES, type Ticket, type TicketState, type TicketType } from "../api/tickets.ts";

/** Value of the epic filter that keeps only tickets without an epic (D9). */
export const NO_EPIC = "none";

/**
 * Board filters (spec §8). They run in the browser and are combined with AND. They live in the URL
 * (`type`, `epic`, `q`) so a reload or Back/Forward keeps them.
 * - `type`: "" (all) or a ticket type
 * - `epic`: "" (all), `NO_EPIC`, or an epic id
 * - `q`: case-insensitive title substring ("" = no search)
 */
export interface BoardFilters {
  type: TicketType | "";
  epic: string;
  q: string;
}

export const EMPTY_FILTERS: BoardFilters = { type: "", epic: "", q: "" };

/** Reads the filters from the URL. Unknown type values are ignored. */
export function filtersFromParams(params: URLSearchParams): BoardFilters {
  const type = params.get("type") ?? "";
  return {
    type: TICKET_TYPES.some((t) => t.value === type) ? (type as TicketType) : "",
    epic: params.get("epic") ?? "",
    q: params.get("q") ?? "",
  };
}

/** Writes the filters into a copy of the URL parameters, leaving out empty values. */
export function applyFiltersToParams(params: URLSearchParams, filters: Partial<BoardFilters>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
  }
  return next;
}

export function hasActiveFilters(filters: BoardFilters): boolean {
  return filters.type !== "" || filters.epic !== "" || filters.q.trim() !== "";
}

export function matchesFilters(ticket: Ticket, filters: BoardFilters): boolean {
  if (filters.type && ticket.type !== filters.type) {
    return false;
  }
  if (filters.epic === NO_EPIC ? ticket.epicId !== null : filters.epic !== "" && ticket.epicId !== filters.epic) {
    return false;
  }
  const q = filters.q.trim().toLocaleLowerCase();
  return q === "" || ticket.title.toLocaleLowerCase().includes(q);
}

/** Same order as the API: modifiedAt desc, then createdAt desc, then id asc. ISO-8601 UTC strings sort as text. */
export function compareTickets(a: Ticket, b: Ticket): number {
  if (a.modifiedAt !== b.modifiedAt) {
    return a.modifiedAt < b.modifiedAt ? 1 : -1;
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface BoardColumns {
  /** Visible (filtered) tickets per state, most recently modified first. */
  columns: Record<TicketState, Ticket[]>;
  /** Unfiltered ticket count per state. */
  totals: Record<TicketState, number>;
  total: number;
  shown: number;
}

function emptyRecord<T>(make: () => T): Record<TicketState, T> {
  return Object.fromEntries(TICKET_STATES.map((s) => [s.value, make()])) as Record<TicketState, T>;
}

/**
 * Groups tickets into the five workflow columns, applies the filters and sorts each column.
 * The client re-sorts so optimistic moves and rollbacks land in the right place without waiting for a refetch.
 */
export function groupTicketsByState(tickets: readonly Ticket[], filters: BoardFilters): BoardColumns {
  const columns = emptyRecord<Ticket[]>(() => []);
  const totals = emptyRecord(() => 0);
  let shown = 0;
  for (const ticket of tickets) {
    totals[ticket.state] += 1;
    if (matchesFilters(ticket, filters)) {
      columns[ticket.state].push(ticket);
      shown += 1;
    }
  }
  for (const state of TICKET_STATES) {
    columns[state.value].sort(compareTickets);
  }
  return { columns, totals, total: tickets.length, shown };
}

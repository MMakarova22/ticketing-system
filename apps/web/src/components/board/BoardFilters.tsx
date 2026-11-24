import type { ReactNode } from "react";
import type { Epic } from "../../api/epics.ts";
import { TICKET_TYPES, type TicketType } from "../../api/tickets.ts";
import { type BoardFilters as Filters, hasActiveFilters, NO_EPIC } from "../../lib/board.ts";
import { SearchIcon } from "../icons.tsx";

interface BoardFiltersProps {
  /** The team selector, shown first in the row (it scopes everything else). Owned by BoardPage. */
  team: ReactNode;
  filters: Filters;
  epics: Epic[] | undefined;
  epicsError: string | null;
  shown: number;
  total: number;
  onChange: (change: Partial<Filters>) => void;
  onClear: () => void;
}

/**
 * The board's search region: the team selector, then title search, type and epic (including "No epic", D9) filters,
 * combined with AND, then Clear and the result count. The count stays mounted (aria-live) so changes are announced;
 * it is deliberately not role="status" (dnd-kit already renders one on the board). New ticket is not part of this
 * region (BoardPage renders it right after).
 */
export function BoardFilters({ team, filters, epics, epicsError, shown, total, onChange, onClear }: BoardFiltersProps) {
  // While epics load, keep showing the selected epic so the select does not jump back to "All epics".
  const epicOptions = epics ?? [];
  const unknownEpic = filters.epic !== "" && filters.epic !== NO_EPIC && !epicOptions.some((e) => e.id === filters.epic);

  return (
    <div className="board-filters" role="search" aria-label="Board filters">
      {team}
      <label className="field grow board-search">
        <span className="visually-hidden">Search titles</span>
        <SearchIcon className="board-search-icon" size={14} />
        <input
          type="search"
          value={filters.q}
          placeholder="Search titles…"
          onChange={(event) => onChange({ q: event.target.value })}
        />
      </label>
      <label className="field board-filter">
        <span>Type</span>
        <select value={filters.type} onChange={(event) => onChange({ type: event.target.value as TicketType | "" })}>
          <option value="">All types</option>
          {TICKET_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field board-filter">
        <span>Epic</span>
        <select
          value={filters.epic}
          disabled={epicsError !== null}
          onChange={(event) => onChange({ epic: event.target.value })}
        >
          <option value="">All epics</option>
          <option value={NO_EPIC}>No epic</option>
          {unknownEpic && <option value={filters.epic}>Loading…</option>}
          {epicOptions.map((epic) => (
            <option key={epic.id} value={epic.id}>
              {epic.title}
            </option>
          ))}
        </select>
        {epicsError && <small className="field-error">Could not load epics: {epicsError}</small>}
      </label>
      <button
        type="button"
        className="button button-ghost button-small board-clear"
        onClick={onClear}
        disabled={!hasActiveFilters(filters)}
      >
        Clear
      </button>
      <p className="board-summary muted" aria-live="polite" data-testid="board-summary">
        {hasActiveFilters(filters) ? `Showing ${shown} of ${total} tickets` : `${total} ${total === 1 ? "ticket" : "tickets"}`}
      </p>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { ApiError } from "../api/client.ts";
import { useEpics } from "../api/epics.ts";
import { type Team, useTeams } from "../api/teams.ts";
import {
  type MoveTicketVariables,
  stateLabel,
  type Ticket,
  type TicketState,
  useMoveTicket,
  usePendingMoveIds,
  useTickets,
} from "../api/tickets.ts";
import { Board } from "../components/board/Board.tsx";
import { BoardFilters } from "../components/board/BoardFilters.tsx";
import { PlusIcon } from "../components/icons.tsx";
import {
  applyFiltersToParams,
  type BoardFilters as Filters,
  EMPTY_FILTERS,
  filtersFromParams,
  groupTicketsByState,
  NO_EPIC,
} from "../lib/board.ts";

function moveErrorMessage(error: Error, { ticket, to }: MoveTicketVariables): string {
  if (error instanceof ApiError && error.status === 404) {
    return `"${ticket.title}" no longer exists, so it could not be moved.`;
  }
  return (
    `Couldn't move "${ticket.title}" to ${stateLabel(to)}; it was returned to ${stateLabel(ticket.state)}. ` +
    error.message
  );
}

/**
 * Kanban board (spec §8). One team at a time, five workflow columns, drag-and-drop between any columns.
 *
 * URL: `?teamId=…&type=…&epic=…&q=…`. Changing the team adds a history entry (and resets the team-specific epic
 * filter); filter changes replace the current entry, so typing a search does not flood the history.
 *
 * Toolbar (UI redesign steps 4 and 6): the "Board filters" search region (team, search, type, epic, Clear, count),
 * then New ticket, outside that region. The h1 is visually hidden. The element tree is the same at every width; the
 * responsive layout is CSS only (board.css), and the DOM order matches the visual order, so focus never jumps back.
 */
export function BoardPage() {
  const teams = useTeams();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [moveError, setMoveError] = useState<string | null>(null);

  const requestedTeamId = searchParams.get("teamId");
  const team: Team | undefined = teams.data?.find((t) => t.id === requestedTeamId) ?? teams.data?.[0];
  const tickets = useTickets(team?.id);
  const epics = useEpics(team?.id);

  // A missing or unknown team id falls back to the first team; the URL is rewritten without a history entry.
  useEffect(() => {
    if (team && requestedTeamId !== team.id) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("teamId", team.id);
          if (requestedTeamId !== null) {
            next.delete("epic");
          }
          return next;
        },
        { replace: true },
      );
    }
  }, [team, requestedTeamId, setSearchParams]);

  const urlFilters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  // An epic filter that names no epic of this team (deleted, or a stale link) is dropped.
  const staleEpic =
    urlFilters.epic !== "" &&
    urlFilters.epic !== NO_EPIC &&
    epics.isSuccess &&
    !epics.data.some((epic) => epic.id === urlFilters.epic);
  const filters = useMemo(() => (staleEpic ? { ...urlFilters, epic: "" } : urlFilters), [urlFilters, staleEpic]);
  useEffect(() => {
    if (staleEpic) {
      setSearchParams((prev) => applyFiltersToParams(prev, { epic: "" }), { replace: true });
    }
  }, [staleEpic, setSearchParams]);

  const board = useMemo(() => groupTicketsByState(tickets.data ?? [], filters), [tickets.data, filters]);

  const pendingIds = usePendingMoveIds();
  const move = useMoveTicket((error, variables) => setMoveError(moveErrorMessage(error, variables)));
  const { mutate } = move;
  const onMove = useCallback(
    (ticket: Ticket, to: TicketState) => {
      setMoveError(null);
      mutate({ ticket, to });
    },
    [mutate],
  );

  function selectTeam(teamId: string) {
    setMoveError(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("teamId", teamId);
      next.delete("epic");
      return next;
    });
  }

  function changeFilters(change: Partial<Filters>) {
    setSearchParams((prev) => applyFiltersToParams(prev, change), { replace: true });
  }

  const clearFilters = () => changeFilters(EMPTY_FILTERS);

  return (
    <section className="page page-board">
      {/* The heading names the page for assistive technology; visually the toolbar starts the page. */}
      <h1 className="visually-hidden">Board</h1>
      {team && (
        <div className="board-toolbar">
          <BoardFilters
            team={
              teams.isSuccess && (
                <label className="field team-select board-team">
                  <span className="visually-hidden">Team</span>
                  <select value={team.id} onChange={(event) => selectTeam(event.target.value)}>
                    {teams.data.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )
            }
            filters={filters}
            epics={epics.data}
            epicsError={epics.isError ? epics.error.message : null}
            shown={board.shown}
            total={board.total}
            onChange={changeFilters}
            onClear={clearFilters}
          />
          <Link to={`/tickets/new?teamId=${team.id}`} className="button board-new-ticket">
            <PlusIcon size={14} />
            New ticket
          </Link>
        </div>
      )}

      {teams.isPending && <p className="muted">Loading teams…</p>}
      {teams.isError && (
        <div className="alert alert-error" role="alert">
          Could not load teams: {teams.error.message}{" "}
          <button type="button" className="button button-secondary button-small" onClick={() => void teams.refetch()}>
            Retry
          </button>
        </div>
      )}
      {teams.isSuccess && !team && (
        <div className="panel empty-state">
          <p>Tickets belong to a team, and there are no teams yet.</p>
          <Link to="/teams" className="button">
            Go to Teams
          </Link>
        </div>
      )}

      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}

      {moveError && (
        <div className="alert alert-error alert-dismissible" role="alert" data-testid="move-error">
          <span>{moveError}</span>
          <button type="button" className="button button-secondary button-small" onClick={() => setMoveError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {team && (
        <>
          {tickets.isPending && <p className="muted">Loading tickets…</p>}
          {tickets.isError && (
            <div className="alert alert-error" role="alert">
              Could not load tickets: {tickets.error.message}{" "}
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => void tickets.refetch()}
              >
                Retry
              </button>
            </div>
          )}
          {tickets.isSuccess && (
            <>
              {board.total === 0 && (
                <p className="alert alert-info">No tickets for this team yet. Create one to get started.</p>
              )}
              {board.total > 0 && board.shown === 0 && (
                <p className="alert alert-info">
                  No tickets match the filters.{" "}
                  <button type="button" className="button button-secondary button-small" onClick={clearFilters}>
                    Clear filters
                  </button>
                </p>
              )}
              <Board tickets={tickets.data} board={board} pendingIds={pendingIds} onMove={onMove} />
            </>
          )}
        </>
      )}
    </section>
  );
}

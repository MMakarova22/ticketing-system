import { Link, useNavigate, useSearchParams } from "react-router";
import { useTeams } from "../api/teams.ts";
import { TicketForm } from "../components/TicketForm.tsx";
import { ChevronLeftIcon } from "../components/icons.tsx";

/** Ticket creation screen. The team from ?teamId=… is preselected; new tickets start in "New". */
export function NewTicketPage() {
  const teams = useTeams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedTeamId = searchParams.get("teamId");
  const initialTeamId = teams.data?.some((t) => t.id === requestedTeamId) ? (requestedTeamId ?? undefined) : undefined;
  const boardPath = initialTeamId ? `/?teamId=${initialTeamId}` : "/";

  return (
    <section className="page page-narrow">
      <p>
        <Link to={boardPath} className="back-link">
          <ChevronLeftIcon size={14} />
          Back to board
        </Link>
      </p>
      {teams.isPending && <p className="muted">Loading teams…</p>}
      {teams.isError && (
        <div className="alert alert-error" role="alert">
          Could not load teams: {teams.error.message}{" "}
          <button type="button" className="button button-secondary button-small" onClick={() => void teams.refetch()}>
            Retry
          </button>
        </div>
      )}
      {teams.isSuccess && teams.data.length === 0 && (
        <div className="panel empty-state">
          <p>Tickets belong to a team, and there are no teams yet.</p>
          <Link to="/teams" className="button">
            Go to Teams
          </Link>
        </div>
      )}
      {teams.isSuccess && teams.data.length > 0 && (
        <TicketForm
          teams={teams.data}
          initialTeamId={initialTeamId}
          onCancel={() => void navigate(boardPath)}
          onSaved={(ticket) =>
            void navigate(`/tickets/${ticket.id}`, { state: { notice: `Ticket "${ticket.title}" created.` } })
          }
        />
      )}
    </section>
  );
}

import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ApiError } from "../api/client.ts";
import { useTeams } from "../api/teams.ts";
import {
  stateLabel,
  type Ticket,
  typeLabel,
  useAddComment,
  useComments,
  useDeleteTicket,
  useTicket,
} from "../api/tickets.ts";
import { TicketForm } from "../components/TicketForm.tsx";
import { ChevronLeftIcon } from "../components/icons.tsx";
import { formatDateTime } from "../lib/format.ts";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Ticket details with edit, delete and comments (spec §6, §7). */
export function TicketPage() {
  const { id = "" } = useParams();
  const ticket = useTicket(id);

  if (ticket.isPending) {
    return <p className="muted">Loading ticket…</p>;
  }
  if (ticket.isError) {
    const missing = ticket.error instanceof ApiError && (ticket.error.status === 404 || ticket.error.status === 400);
    return (
      <section className="page page-narrow">
        <h1>{missing ? "Ticket not found" : "Could not load the ticket"}</h1>
        {missing ? (
          <p className="muted">It may have been deleted.</p>
        ) : (
          <div className="alert alert-error" role="alert">
            {ticket.error.message}{" "}
            <button type="button" className="button button-secondary button-small" onClick={() => void ticket.refetch()}>
              Retry
            </button>
          </div>
        )}
        <p>
          <Link to="/">Go to the board</Link>
        </p>
      </section>
    );
  }
  // Remount per ticket so local state (edit mode, notices) never leaks between tickets.
  return <TicketDetails key={ticket.data.id} ticket={ticket.data} />;
}

function TicketDetails({ ticket }: { ticket: Ticket }) {
  const teams = useTeams();
  const navigate = useNavigate();
  const location = useLocation();
  const remove = useDeleteTicket();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    () => (location.state as { notice?: string } | null)?.notice ?? null,
  );
  const teamName = teams.data?.find((t) => t.id === ticket.teamId)?.name;
  const boardPath = `/?teamId=${ticket.teamId}`;

  function deleteTicket() {
    setNotice(null);
    const comments = ticket.commentCount > 0 ? ` Its ${plural(ticket.commentCount, "comment")} will be deleted too.` : "";
    if (!window.confirm(`Delete ticket "${ticket.title}"?${comments} This cannot be undone.`)) {
      return;
    }
    remove.mutate(ticket.id, {
      onSuccess: () => void navigate(boardPath, { state: { notice: `Ticket "${ticket.title}" deleted.` } }),
    });
  }

  return (
    <section className="page page-narrow page-ticket">
      <p>
        <Link to={boardPath} className="back-link">
          <ChevronLeftIcon size={14} />
          Back to board
        </Link>
      </p>

      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}

      {/* The title stays the page's visible h1, also while editing. */}
      <div className="page-header">
        <h1>{ticket.title}</h1>
        {!editing && (
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setEditing(true);
                setNotice(null);
                remove.reset();
              }}
              disabled={!teams.isSuccess || remove.isPending}
            >
              Edit
            </button>
            <button type="button" className="button button-danger" onClick={deleteTicket} disabled={remove.isPending}>
              {remove.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        )}
      </div>

      {editing && teams.isSuccess ? (
        <TicketForm
          teams={teams.data}
          ticket={ticket}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            setNotice(`Ticket "${saved.title}" saved.`);
          }}
        />
      ) : (
        <article className="panel ticket-details" aria-label="Ticket details">
          {remove.isError && (
            <p className="alert alert-error" role="alert">
              Could not delete the ticket: {remove.error.message}
            </p>
          )}
          <dl className="details">
            <dt>Team</dt>
            <dd data-testid="ticket-team">{teamName ?? "…"}</dd>
            <dt>Epic</dt>
            <dd data-testid="ticket-epic">{ticket.epic?.title ?? "No epic"}</dd>
            <dt>Type</dt>
            <dd data-testid="ticket-type">
              <span className={`badge badge-${ticket.type}`}>{typeLabel(ticket.type)}</span>
            </dd>
            <dt>State</dt>
            <dd data-testid="ticket-state">
              <span className="chip chip-state" data-state={ticket.state}>
                {stateLabel(ticket.state)}
              </span>
            </dd>
            <dt>Created by</dt>
            <dd data-testid="ticket-created-by">{ticket.createdBy.email}</dd>
            <dt>Created</dt>
            <dd>{formatDateTime(ticket.createdAt)}</dd>
            <dt>Modified</dt>
            <dd data-testid="ticket-modified">{formatDateTime(ticket.modifiedAt)}</dd>
          </dl>
          <div className="ticket-body" data-testid="ticket-body">
            {ticket.body}
          </div>
        </article>
      )}

      <Comments ticketId={ticket.id} />
    </section>
  );
}

/** Comments are immutable: they can be added and read, never edited or deleted (spec §7). */
function Comments({ ticketId }: { ticketId: string }) {
  const comments = useComments(ticketId);
  const add = useAddComment(ticketId);
  const [body, setBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) {
      setFormError("Enter a comment.");
      return;
    }
    setFormError(null);
    add.mutate(body.trim(), { onSuccess: () => setBody("") });
  }

  const error = formError ?? (add.isError ? add.error.message : null);

  return (
    <section className="panel comments" aria-labelledby="comments-heading">
      <h2 id="comments-heading" className="form-title">
        Comments
      </h2>
      {comments.isPending && <p className="muted">Loading comments…</p>}
      {comments.isError && (
        <div className="alert alert-error" role="alert">
          Could not load comments: {comments.error.message}{" "}
          <button type="button" className="button button-secondary button-small" onClick={() => void comments.refetch()}>
            Retry
          </button>
        </div>
      )}
      {comments.isSuccess && comments.data.length === 0 && <p className="muted">No comments yet.</p>}
      {comments.isSuccess && comments.data.length > 0 && (
        <ol className="comment-list">
          {comments.data.map((comment) => (
            <li key={comment.id} className="comment" data-testid="comment">
              <div className="comment-meta">
                <strong data-testid="comment-author">{comment.author.email}</strong>{" "}
                <time dateTime={comment.createdAt} className="muted" data-testid="comment-time">
                  {formatDateTime(comment.createdAt)}
                </time>
              </div>
              <div className="comment-body" data-testid="comment-body">
                {comment.body}
              </div>
            </li>
          ))}
        </ol>
      )}

      <form className="form" onSubmit={onSubmit} noValidate aria-label="New comment">
        <label className="field">
          <span>Add a comment</span>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} />
        </label>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button" disabled={add.isPending}>
            {add.isPending ? "Adding…" : "Add comment"}
          </button>
        </div>
      </form>
    </section>
  );
}

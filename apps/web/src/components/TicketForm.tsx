import { type FormEvent, useState } from "react";
import { useEpics } from "../api/epics.ts";
import type { Team } from "../api/teams.ts";
import {
  TICKET_STATES,
  TICKET_TYPES,
  type Ticket,
  type TicketChanges,
  type TicketState,
  type TicketType,
  useCreateTicket,
  useUpdateTicket,
} from "../api/tickets.ts";

interface Fields {
  teamId: string;
  /** "" means "No epic". */
  epicId: string;
  type: TicketType;
  state: TicketState;
  title: string;
  body: string;
}

/**
 * Create/edit form for a ticket (spec §6). Changing the team clears the epic, and the epic list only offers the
 * selected team's epics, so the ticket's epic always belongs to its team. The server enforces the same rule.
 * Editing sends only the fields that changed.
 */
export function TicketForm({
  teams,
  ticket,
  initialTeamId,
  onCancel,
  onSaved,
}: {
  teams: Team[];
  /** The ticket to edit; omitted when creating. */
  ticket?: Ticket;
  initialTeamId?: string | undefined;
  onCancel: () => void;
  onSaved: (ticket: Ticket) => void;
}) {
  const create = useCreateTicket();
  const update = useUpdateTicket();
  const mutation = ticket ? update : create;
  const [fields, setFields] = useState<Fields>(() => ({
    teamId: ticket?.teamId ?? initialTeamId ?? teams[0]?.id ?? "",
    epicId: ticket?.epicId ?? "",
    type: ticket?.type ?? "feature",
    state: ticket?.state ?? "new",
    title: ticket?.title ?? "",
    body: ticket?.body ?? "",
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const epics = useEpics(fields.teamId || undefined);
  const heading = ticket ? "Edit ticket" : "New ticket";

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function selectTeam(teamId: string) {
    // An epic belongs to one team, so a team change always clears the epic.
    setFields((current) => ({ ...current, teamId, epicId: "" }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!fields.teamId) {
      setFormError("Select a team.");
      return;
    }
    if (!fields.title.trim()) {
      setFormError("Enter a ticket title.");
      return;
    }
    if (!fields.body.trim()) {
      setFormError("Enter a ticket body.");
      return;
    }
    setFormError(null);

    const values = {
      teamId: fields.teamId,
      epicId: fields.epicId || null,
      type: fields.type,
      title: fields.title.trim(),
      body: fields.body.trim(),
    };
    if (!ticket) {
      create.mutate(values, { onSuccess: onSaved });
      return;
    }
    const changes: TicketChanges = {};
    if (values.teamId !== ticket.teamId) changes.teamId = values.teamId;
    if (values.epicId !== ticket.epicId) changes.epicId = values.epicId;
    if (values.type !== ticket.type) changes.type = values.type;
    if (fields.state !== ticket.state) changes.state = fields.state;
    if (values.title !== ticket.title) changes.title = values.title;
    if (values.body !== ticket.body) changes.body = values.body;
    update.mutate({ id: ticket.id, changes }, { onSuccess: onSaved });
  }

  const error = formError ?? (mutation.isError ? mutation.error.message : null);

  return (
    <form className="panel form" onSubmit={onSubmit} noValidate aria-label={heading}>
      <h2 className="form-title">{heading}</h2>
      <div className="form-row">
        <label className="field">
          <span>Team</span>
          <select value={fields.teamId} onChange={(event) => selectTeam(event.target.value)}>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Epic</span>
          <select
            value={fields.epicId}
            onChange={(event) => set("epicId", event.target.value)}
            disabled={!epics.isSuccess}
          >
            <option value="">No epic</option>
            {epics.data?.map((epic) => (
              <option key={epic.id} value={epic.id}>
                {epic.title}
              </option>
            ))}
          </select>
          {epics.isPending && <small className="muted">Loading epics…</small>}
          {epics.isError && <small className="muted">Could not load epics: {epics.error.message}</small>}
        </label>
        <label className="field">
          <span>Type</span>
          <select value={fields.type} onChange={(event) => set("type", event.target.value as TicketType)}>
            {TICKET_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        {ticket && (
          <label className="field">
            <span>State</span>
            <select value={fields.state} onChange={(event) => set("state", event.target.value as TicketState)}>
              {TICKET_STATES.map((state) => (
                <option key={state.value} value={state.value}>
                  {state.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="field">
        <span>Title</span>
        <input value={fields.title} onChange={(event) => set("title", event.target.value)} autoFocus required />
      </label>
      <label className="field">
        <span>Body</span>
        <textarea value={fields.body} onChange={(event) => set("body", event.target.value)} rows={8} required />
      </label>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button button-secondary" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : ticket ? "Save" : "Create ticket"}
        </button>
      </div>
    </form>
  );
}

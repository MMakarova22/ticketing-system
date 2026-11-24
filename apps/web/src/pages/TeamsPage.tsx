import { type FormEvent, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { type Team, useCreateTeam, useDeleteTeam, useRenameTeam, useTeams } from "../api/teams.ts";
import { useFieldError } from "../components/forms/useFieldError.tsx";
import { useFocusAfterBusy } from "../components/forms/useFocusAfterBusy.ts";
import { PlusIcon } from "../components/icons.tsx";
import { formatDateTime, formatModified } from "../lib/format.ts";

const DELETE_DISABLED_HINT = "Delete is disabled while a team contains tickets or epics.";

/** Where focus goes after the next render: the Create team button, or a row's Edit button (by team id). */
type FocusRequest = { to: "create" } | { to: "edit"; teamId: string };

/**
 * Team management (spec §4, wireframe 4): list with counts, create, rename and delete. The h1 is visually hidden
 * (the navigation shows where you are). Focus returns to the control that started an action: Create team after
 * creating or cancelling, the row's Edit after renaming or cancelling, and after a delete the next (or previous) row's
 * Edit, or Create team when the list is empty.
 */
export function TeamsPage() {
  const teams = useTeams();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Owned here, not by the row: a deleted row unmounts, and its own mutate() callbacks would never run.
  const remove = useDeleteTeam();
  const noteId = useId();

  const createButton = useRef<HTMLButtonElement | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusRequest = useRef<FocusRequest | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const registerEditButton = useCallback((teamId: string, button: HTMLButtonElement | null) => {
    if (button) {
      editButtons.current.set(teamId, button);
    } else {
      editButtons.current.delete(teamId);
    }
  }, []);

  function requestFocus(request: FocusRequest) {
    focusRequest.current = request;
    setFocusTick((tick) => tick + 1);
  }

  // After the render that follows a request (the button may only exist from that render on).
  useLayoutEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (!request) {
      return;
    }
    const target = request.to === "edit" ? editButtons.current.get(request.teamId) : undefined;
    (target ?? createButton.current)?.focus();
  }, [focusTick]);

  function deleteTeam(team: Team) {
    setNotice(null);
    if (!window.confirm(`Delete team "${team.name}"? This cannot be undone.`)) {
      return;
    }
    // The row that takes the deleted row's place (or the one before it) gets focus afterwards.
    const list = teams.data ?? [];
    const index = list.findIndex((t) => t.id === team.id);
    const neighbour = list[index + 1] ?? list[index - 1];
    remove.mutate(team.id, {
      onSuccess: () => {
        setNotice(`Team "${team.name}" deleted.`);
        requestFocus(neighbour ? { to: "edit", teamId: neighbour.id } : { to: "create" });
      },
    });
  }

  return (
    <section className="page page-teams">
      <h1 className="visually-hidden">Teams</h1>
      <div className="page-header">
        <p className="muted">All verified users can view and manage all teams.</p>
        {!creating && (
          <button
            ref={createButton}
            type="button"
            className="button"
            onClick={() => {
              setCreating(true);
              setNotice(null);
            }}
          >
            <PlusIcon size={14} />
            Create team
          </button>
        )}
      </div>

      {creating && (
        <CreateTeamForm
          onCancel={() => {
            setCreating(false);
            requestFocus({ to: "create" });
          }}
          onCreated={(team) => {
            setCreating(false);
            setNotice(`Team "${team.name}" created.`);
            requestFocus({ to: "create" });
          }}
        />
      )}

      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}

      <div className="panel">
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
          <p className="empty-state">No teams yet. Create the first team to start organizing tickets.</p>
        )}
        {teams.isSuccess && teams.data.length > 0 && (
          <>
            <p id={noteId} className="table-note muted">
              {DELETE_DISABLED_HINT}
            </p>
            {/* Scrolls sideways inside the panel on narrow screens; the page itself never does. */}
            <div className="table-scroll">
              <table className="table table-teams" aria-label="Teams">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col" className="num">
                      Tickets
                    </th>
                    <th scope="col" className="num">
                      Epics
                    </th>
                    <th scope="col">Modified</th>
                    <th scope="col" className="actions">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {teams.data.map((team) => (
                    <TeamRow
                      key={team.id}
                      team={team}
                      noteId={noteId}
                      registerEditButton={registerEditButton}
                      onNotice={setNotice}
                      onDelete={() => deleteTeam(team)}
                      deleting={remove.isPending && remove.variables === team.id}
                      deleteError={remove.isError && remove.variables === team.id ? remove.error.message : null}
                      resetDelete={remove.reset}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Create form. A blank name is a field error (at the input, which gets focus); server errors such as the duplicate
 * name (409) stay one form-level alert. Only one of the two is shown at a time.
 */
function CreateTeamForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (team: Team) => void }) {
  const create = useCreateTeam();
  const fields = useFieldError<"name">();
  const [name, setName] = useState("");
  // A server error (e.g. 409) keeps focus on Create: it is disabled while the request runs.
  const submit = useRef<HTMLButtonElement | null>(null);
  useFocusAfterBusy(submit, create.isPending);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    create.reset();
    if (!fields.validate([["name", "Enter a team name.", name.trim() !== ""]])) {
      return;
    }
    create.mutate(name, { onSuccess: onCreated });
  }

  return (
    <form className="panel form" onSubmit={onSubmit} noValidate aria-label="Create team">
      <h2 className="form-title">Create team</h2>
      <div className="inline-form">
        <label className="field grow">
          <span>Team name</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              fields.clearField("name");
            }}
            placeholder="e.g. Platform Engineering"
            autoFocus
            required
            {...fields.fieldProps("name")}
          />
        </label>
        <button ref={submit} type="submit" className="button" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create"}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel} disabled={create.isPending}>
          Cancel
        </button>
      </div>
      {fields.errorMessage("name")}
      {create.isError && (
        <p className="alert alert-error" role="alert">
          {create.error.message}
        </p>
      )}
    </form>
  );
}

interface TeamRowProps {
  team: Team;
  /** Id of the note that explains why Delete can be disabled. */
  noteId: string;
  registerEditButton: (teamId: string, button: HTMLButtonElement | null) => void;
  onNotice: (message: string | null) => void;
  onDelete: () => void;
  deleting: boolean;
  deleteError: string | null;
  resetDelete: () => void;
}

function TeamRow({
  team,
  noteId,
  registerEditButton,
  onNotice,
  onDelete,
  deleting,
  deleteError,
  resetDelete,
}: TeamRowProps) {
  const rename = useRenameTeam();
  const fields = useFieldError<"name">();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);

  const inUse = team.ticketCount + team.epicCount > 0;

  // Save and Delete are disabled while their request runs; after a failure focus goes back to them.
  const saveButton = useRef<HTMLButtonElement | null>(null);
  const deleteButton = useRef<HTMLButtonElement | null>(null);
  useFocusAfterBusy(saveButton, rename.isPending);
  useFocusAfterBusy(deleteButton, deleting);

  // Back to this row's Edit button after Save or Cancel.
  const editButton = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  const teamId = team.id;
  const setEditButton = useCallback(
    (button: HTMLButtonElement | null) => {
      editButton.current = button;
      registerEditButton(teamId, button);
    },
    [registerEditButton, teamId],
  );
  useLayoutEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  function startEditing() {
    setName(team.name);
    fields.clear();
    rename.reset();
    resetDelete();
    onNotice(null);
    setEditing(true);
  }

  function stopEditing() {
    returnFocus.current = true;
    setEditing(false);
  }

  function onSave(event: FormEvent) {
    event.preventDefault();
    rename.reset();
    if (!fields.validate([["name", "Enter a team name.", name.trim() !== ""]])) {
      return;
    }
    rename.mutate(
      { id: team.id, name },
      {
        onSuccess: (updated) => {
          stopEditing();
          onNotice(`Team "${updated.name}" saved.`);
        },
      },
    );
  }

  const serverError = rename.isError ? rename.error.message : deleteError;

  return (
    <tr data-testid="team-row" className={editing ? "editing" : undefined}>
      <td className="name">
        {editing ? (
          <form id={`rename-${team.id}`} onSubmit={onSave} noValidate>
            <label className="field">
              <span className="visually-hidden">Team name</span>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  fields.clearField("name");
                }}
                autoFocus
                required
                {...fields.fieldProps("name")}
              />
            </label>
            {fields.errorMessage("name")}
          </form>
        ) : (
          <strong>{team.name}</strong>
        )}
        {serverError && (
          <p className="alert alert-error row-error" role="alert">
            {serverError}
          </p>
        )}
      </td>
      <td className="num">{team.ticketCount}</td>
      <td className="num">{team.epicCount}</td>
      <td className="modified" title={formatDateTime(team.modifiedAt)}>
        {formatModified(team.modifiedAt)}
      </td>
      <td className="actions">
        {/* Distinct keys: React must not reuse the Edit button's DOM node as the submit button, or the click
            that starts editing would also submit the form. */}
        {editing ? (
          <>
            <button
              key="save"
              ref={saveButton}
              type="submit"
              form={`rename-${team.id}`}
              className="button button-small"
              disabled={rename.isPending}
            >
              {rename.isPending ? "Saving…" : "Save"}
            </button>
            <button
              key="cancel"
              type="button"
              className="button button-secondary button-small"
              onClick={() => {
                // A failed rename's message must not outlive the edit (it would also hide a later delete error).
                rename.reset();
                stopEditing();
              }}
              disabled={rename.isPending}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              key="edit"
              ref={setEditButton}
              type="button"
              className="button button-secondary button-small"
              onClick={startEditing}
            >
              Edit
            </button>
            <button
              key="delete"
              ref={deleteButton}
              type="button"
              className="button button-danger-subtle button-small"
              onClick={onDelete}
              disabled={inUse || deleting}
              title={inUse ? DELETE_DISABLED_HINT : undefined}
              aria-describedby={inUse ? noteId : undefined}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

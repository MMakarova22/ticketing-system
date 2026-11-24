import { type FormEvent, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type Epic, useCreateEpic, useDeleteEpic, useEpics, useUpdateEpic } from "../api/epics.ts";
import { type Team, useTeams } from "../api/teams.ts";
import { useFieldError } from "../components/forms/useFieldError.tsx";
import { useFocusAfterBusy } from "../components/forms/useFocusAfterBusy.ts";
import { PlusIcon } from "../components/icons.tsx";
import { formatDateTime, formatModified } from "../lib/format.ts";

const DELETE_DISABLED_HINT = "Delete is disabled while tickets reference the epic.";

type PanelState = { mode: "create" } | { mode: "edit"; epic: Epic } | null;

/** Where focus goes after the next render: the Create epic button, or a row's Edit button (by epic id). */
type FocusRequest = { to: "create" } | { to: "edit"; epicId: string };

/**
 * Epic management (spec §5, wireframe 5): epics of the selected team, with create/edit in a side panel.
 * The selected team is kept in the URL (?teamId=…) so reloads and deep links keep it. The h1 is visually hidden; the
 * header row is the team selector, then Create epic (DOM order = visual order). Focus returns to the control that
 * opened the panel when it closes; after a delete it goes to the next (or previous) row's Edit, or to Create epic.
 */
export function EpicsPage() {
  const teams = useTeams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [panel, setPanel] = useState<PanelState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Owned here, not by the row: a deleted row unmounts, and its own mutate() callbacks would never run.
  const remove = useDeleteEpic();
  const noteId = useId();

  const requestedTeamId = searchParams.get("teamId");
  const team: Team | undefined = teams.data?.find((t) => t.id === requestedTeamId) ?? teams.data?.[0];
  const epics = useEpics(team?.id);

  const createButton = useRef<HTMLButtonElement | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusRequest = useRef<FocusRequest | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const registerEditButton = useCallback((epicId: string, button: HTMLButtonElement | null) => {
    if (button) {
      editButtons.current.set(epicId, button);
    } else {
      editButtons.current.delete(epicId);
    }
  }, []);

  function requestFocus(request: FocusRequest) {
    focusRequest.current = request;
    setFocusTick((tick) => tick + 1);
  }

  useLayoutEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (!request) {
      return;
    }
    const target = request.to === "edit" ? editButtons.current.get(request.epicId) : undefined;
    (target ?? createButton.current)?.focus();
  }, [focusTick]);

  /** Closes the panel and returns focus to the control that opened it. */
  function closePanel() {
    if (panel) {
      requestFocus(panel.mode === "edit" ? { to: "edit", epicId: panel.epic.id } : { to: "create" });
    }
    setPanel(null);
  }

  function selectTeam(teamId: string) {
    setSearchParams({ teamId });
    setPanel(null);
    setNotice(null);
    remove.reset();
  }

  function deleteEpic(epic: Epic) {
    setNotice(null);
    if (!window.confirm(`Delete epic "${epic.title}"? This cannot be undone.`)) {
      return;
    }
    const list = epics.data ?? [];
    const index = list.findIndex((e) => e.id === epic.id);
    const neighbour = list[index + 1] ?? list[index - 1];
    remove.mutate(epic, {
      onSuccess: () => {
        setPanel((current) => (current?.mode === "edit" && current.epic.id === epic.id ? null : current));
        setNotice(`Epic "${epic.title}" deleted.`);
        requestFocus(neighbour ? { to: "edit", epicId: neighbour.id } : { to: "create" });
      },
    });
  }

  return (
    <section className="page page-epics">
      <h1 className="visually-hidden">Epics</h1>
      {team && (
        <div className="page-header">
          {teams.isSuccess && (
            <label className="field team-select">
              <span className="visually-hidden">Team</span>
              <select value={team.id} onChange={(event) => selectTeam(event.target.value)}>
                {teams.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            ref={createButton}
            type="button"
            className="button"
            onClick={() => {
              setPanel({ mode: "create" });
              setNotice(null);
            }}
          >
            <PlusIcon size={14} />
            Create epic
          </button>
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
          <p>Epics belong to a team, and there are no teams yet.</p>
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

      {team && (
        <div className={panel ? "split" : undefined}>
          <div className="panel">
            {epics.isPending && <p className="muted">Loading epics…</p>}
            {epics.isError && (
              <div className="alert alert-error" role="alert">
                Could not load epics: {epics.error.message}{" "}
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => void epics.refetch()}
                >
                  Retry
                </button>
              </div>
            )}
            {epics.isSuccess && epics.data.length === 0 && (
              <p className="empty-state">No epics for this team yet. Create one to group related tickets.</p>
            )}
            {epics.isSuccess && epics.data.length > 0 && (
              <>
                <p id={noteId} className="table-note muted">
                  {DELETE_DISABLED_HINT}
                </p>
                {/* Scrolls sideways inside the panel on narrow screens; the page itself never does. */}
                <div className="table-scroll">
                  <table className="table table-epics" aria-label="Epics">
                    <thead>
                      <tr>
                        <th scope="col">Title</th>
                        <th scope="col" className="num">
                          Tickets
                        </th>
                        <th scope="col">Modified</th>
                        <th scope="col" className="actions">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {epics.data.map((epic) => (
                        <EpicRow
                          key={epic.id}
                          epic={epic}
                          noteId={noteId}
                          registerEditButton={registerEditButton}
                          onEdit={() => {
                            setPanel({ mode: "edit", epic });
                            setNotice(null);
                          }}
                          onDelete={() => deleteEpic(epic)}
                          deleting={remove.isPending && remove.variables?.id === epic.id}
                          deleteError={
                            remove.isError && remove.variables?.id === epic.id ? remove.error.message : null
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {panel && (
            <EpicForm
              // Remount for each epic so the fields start from its current values.
              key={panel.mode === "edit" ? panel.epic.id : `create-${team.id}`}
              team={team}
              epic={panel.mode === "edit" ? panel.epic : undefined}
              onCancel={closePanel}
              onSaved={(saved, created) => {
                closePanel();
                setNotice(`Epic "${saved.title}" ${created ? "created" : "saved"}.`);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

function EpicRow({
  epic,
  noteId,
  registerEditButton,
  onEdit,
  onDelete,
  deleting,
  deleteError,
}: {
  epic: Epic;
  /** Id of the note that explains why Delete can be disabled. */
  noteId: string;
  registerEditButton: (epicId: string, button: HTMLButtonElement | null) => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  deleteError: string | null;
}) {
  const inUse = epic.ticketCount > 0;
  const epicId = epic.id;
  // Delete is disabled while its request runs; after a failure focus goes back to it.
  const deleteButton = useRef<HTMLButtonElement | null>(null);
  useFocusAfterBusy(deleteButton, deleting);
  const setEditButton = useCallback(
    (button: HTMLButtonElement | null) => registerEditButton(epicId, button),
    [registerEditButton, epicId],
  );

  return (
    <tr data-testid="epic-row">
      <td className="name">
        <strong>{epic.title}</strong>
        {epic.description && (
          <span className="description muted" title={epic.description}>
            {epic.description}
          </span>
        )}
        {deleteError && (
          <p className="alert alert-error row-error" role="alert">
            {deleteError}
          </p>
        )}
      </td>
      <td className="num">{epic.ticketCount}</td>
      <td className="modified" title={formatDateTime(epic.modifiedAt)}>
        {formatModified(epic.modifiedAt)}
      </td>
      <td className="actions">
        <button
          ref={setEditButton}
          type="button"
          className="button button-secondary button-small"
          onClick={onEdit}
        >
          Edit
        </button>
        <button
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
      </td>
    </tr>
  );
}

/**
 * Create/edit panel. A blank title is a field error (at the input, which gets focus); server errors stay one
 * form-level alert. The team is shown read-only: it is set at creation and cannot be changed.
 */
function EpicForm({
  team,
  epic,
  onCancel,
  onSaved,
}: {
  team: Team;
  epic: Epic | undefined;
  onCancel: () => void;
  onSaved: (epic: Epic, created: boolean) => void;
}) {
  const create = useCreateEpic();
  const update = useUpdateEpic();
  const fields = useFieldError<"title">();
  const [title, setTitle] = useState(epic?.title ?? "");
  const [description, setDescription] = useState(epic?.description ?? "");

  const mutation = epic ? update : create;
  const heading = epic ? "Edit epic" : "Create epic";
  // A server error keeps focus on the submit button: it is disabled while the request runs.
  const submit = useRef<HTMLButtonElement | null>(null);
  useFocusAfterBusy(submit, mutation.isPending);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.reset();
    if (!fields.validate([["title", "Enter an epic title.", title.trim() !== ""]])) {
      return;
    }
    const values = { title, description };
    if (epic) {
      update.mutate({ epic, fields: values }, { onSuccess: (saved) => onSaved(saved, false) });
    } else {
      create.mutate({ teamId: team.id, fields: values }, { onSuccess: (saved) => onSaved(saved, true) });
    }
  }

  return (
    <form className="panel form epic-form" onSubmit={onSubmit} noValidate aria-label={heading}>
      <div className="epic-form-header">
        <h2 className="form-title">{heading}</h2>
        <p className="muted">
          Team: <strong>{team.name}</strong>
          {epic && " (an epic's team cannot be changed)"}
        </p>
      </div>
      <div className="form-field">
        <label className="field">
          <span>Title</span>
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              fields.clearField("title");
            }}
            autoFocus
            required
            {...fields.fieldProps("title")}
          />
        </label>
        {fields.errorMessage("title")}
      </div>
      <label className="field">
        <span>Description (optional)</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} />
      </label>
      {mutation.isError && (
        <p className="alert alert-error" role="alert">
          {mutation.error.message}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button button-secondary" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </button>
        <button ref={submit} type="submit" className="button" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : epic ? "Save" : "Create"}
        </button>
      </div>
    </form>
  );
}

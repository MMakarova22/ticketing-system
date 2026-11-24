import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiFetch, deleteJson, patchJson, postJson } from "./client.ts";
import { TEAMS_QUERY_KEY } from "./teams.ts";

export type TicketType = "bug" | "feature" | "fix";
export type TicketState = "new" | "ready_for_implementation" | "in_progress" | "ready_for_acceptance" | "done";

/** Ticket types with their UI labels (spec §6). Labels only: no type-specific behavior. */
export const TICKET_TYPES: readonly { value: TicketType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature" },
  { value: "fix", label: "Fix" },
];

/** The fixed workflow, in column order (spec §8). Any state can move to any other state. */
export const TICKET_STATES: readonly { value: TicketState; label: string }[] = [
  { value: "new", label: "New" },
  { value: "ready_for_implementation", label: "Ready for implementation" },
  { value: "in_progress", label: "In progress" },
  { value: "ready_for_acceptance", label: "Ready for acceptance" },
  { value: "done", label: "Done" },
];

export function typeLabel(type: TicketType): string {
  return TICKET_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function stateLabel(state: TicketState): string {
  return TICKET_STATES.find((s) => s.value === state)?.label ?? state;
}

export interface Ticket {
  id: string;
  teamId: string;
  epicId: string | null;
  epic: { id: string; title: string } | null;
  type: TicketType;
  state: TicketState;
  title: string;
  body: string;
  createdBy: { id: string; email: string };
  createdAt: string;
  modifiedAt: string;
  commentCount: number;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  body: string;
  author: { id: string; email: string };
  createdAt: string;
}

export interface NewTicket {
  teamId: string;
  epicId: string | null;
  type: TicketType;
  title: string;
  body: string;
}

/** A PATCH body: only the fields that changed. */
export type TicketChanges = Partial<NewTicket & { state: TicketState }>;

const TICKETS_KEY = ["tickets"] as const;

export function ticketsQueryKey(teamId: string) {
  return [...TICKETS_KEY, teamId] as const;
}

export function ticketQueryKey(id: string) {
  return ["ticket", id] as const;
}

export function commentsQueryKey(ticketId: string) {
  return ["comments", ticketId] as const;
}

/** Tickets of one team, most recently modified first. Disabled until a team is selected. */
export function useTickets(teamId: string | undefined) {
  return useQuery({
    queryKey: ticketsQueryKey(teamId ?? ""),
    queryFn: () => apiFetch<Ticket[]>(`/tickets?teamId=${encodeURIComponent(teamId ?? "")}`),
    enabled: Boolean(teamId),
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketQueryKey(id),
    queryFn: () => apiFetch<Ticket>(`/tickets/${encodeURIComponent(id)}`),
  });
}

/**
 * Ticket writes change ticket lists, the ticket itself and the ticket counts shown for teams and epics,
 * so all of those are refreshed.
 */
function useInvalidateTickets() {
  const queryClient = useQueryClient();
  return (ticketId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: TICKETS_KEY }),
      queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["epics"] }),
      ...(ticketId ? [queryClient.invalidateQueries({ queryKey: ticketQueryKey(ticketId) })] : []),
    ]);
}

export function useCreateTicket() {
  const invalidate = useInvalidateTickets();
  return useMutation({
    mutationFn: (ticket: NewTicket) => postJson<Ticket>("/tickets", ticket),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateTicket() {
  const invalidate = useInvalidateTickets();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: TicketChanges }) => patchJson<Ticket>(`/tickets/${id}`, changes),
    onSettled: (_data, _error, { id }) => invalidate(id),
  });
}

export const MOVE_TICKET_KEY = ["moveTicket"] as const;

export interface MoveTicketVariables {
  ticket: Ticket;
  to: TicketState;
}

interface MoveTicketContext {
  previous: Pick<Ticket, "state" | "modifiedAt">;
}

/**
 * Drag-and-drop move: `PATCH {state}` with an optimistic update (spec §8).
 *
 * - The card moves to the target column (top, as the new modifiedAt) before the server answers.
 * - On any failure (HTTP error or network error) **only the moved ticket** gets its previous state and modifiedAt
 *   back, so concurrent moves of other tickets are not lost. `onError` is called so the board can show the error.
 * - The list is refetched only after the last pending move settles; an earlier refetch could overwrite the
 *   optimistic state of a move that is still in flight.
 *
 * The cache key comes from the ticket's own team, so a team switch during a pending move cannot confuse it.
 */
export function useMoveTicket(onError?: (error: Error, variables: MoveTicketVariables) => void) {
  const queryClient = useQueryClient();

  function patchCachedTicket(teamId: string, id: string, change: (ticket: Ticket) => Ticket) {
    queryClient.setQueryData<Ticket[]>(ticketsQueryKey(teamId), (list) =>
      list?.map((ticket) => (ticket.id === id ? change(ticket) : ticket)),
    );
  }

  return useMutation<Ticket, Error, MoveTicketVariables, MoveTicketContext>({
    mutationKey: MOVE_TICKET_KEY,
    mutationFn: ({ ticket, to }) => patchJson<Ticket>(`/tickets/${ticket.id}`, { state: to }),
    onMutate: async ({ ticket, to }) => {
      const key = ticketsQueryKey(ticket.teamId);
      await queryClient.cancelQueries({ queryKey: key });
      const current = queryClient.getQueryData<Ticket[]>(key)?.find((t) => t.id === ticket.id) ?? ticket;
      const previous = { state: current.state, modifiedAt: current.modifiedAt };
      patchCachedTicket(ticket.teamId, ticket.id, (t) => ({ ...t, state: to, modifiedAt: new Date().toISOString() }));
      return { previous };
    },
    onError: (error, variables, context) => {
      if (context) {
        patchCachedTicket(variables.ticket.teamId, variables.ticket.id, (t) => ({ ...t, ...context.previous }));
      }
      onError?.(error, variables);
    },
    onSuccess: (saved, { ticket }) => {
      patchCachedTicket(ticket.teamId, ticket.id, () => saved);
      queryClient.setQueryData(ticketQueryKey(saved.id), saved);
    },
    onSettled: (_data, _error, { ticket }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ticketQueryKey(ticket.id) }),
        // This mutation still counts as pending here, so 1 means "no other move in flight".
        ...(queryClient.isMutating({ mutationKey: MOVE_TICKET_KEY }) === 1
          ? [queryClient.invalidateQueries({ queryKey: ticketsQueryKey(ticket.teamId) })]
          : []),
      ]),
  });
}

/** Ids of tickets whose move is still being saved; such cards cannot be dragged again until it settles. */
export function usePendingMoveIds(): Set<string> {
  const ids = useMutationState({
    filters: { mutationKey: MOVE_TICKET_KEY, status: "pending" },
    select: (mutation) => (mutation.state.variables as MoveTicketVariables | undefined)?.ticket.id ?? "",
  });
  return useMemo(() => new Set(ids.filter(Boolean)), [ids]);
}

export function useDeleteTicket() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTickets();
  return useMutation({
    mutationFn: (id: string) => deleteJson(`/tickets/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ticketQueryKey(id) });
      queryClient.removeQueries({ queryKey: commentsQueryKey(id) });
      return invalidate();
    },
  });
}

/** Comments of a ticket, oldest first. */
export function useComments(ticketId: string) {
  return useQuery({
    queryKey: commentsQueryKey(ticketId),
    queryFn: () => apiFetch<TicketComment[]>(`/tickets/${encodeURIComponent(ticketId)}/comments`),
  });
}

export function useAddComment(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => postJson<TicketComment>(`/tickets/${ticketId}/comments`, { body }),
    // The comment count is part of the ticket views; the ticket's modifiedAt does not change.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: commentsQueryKey(ticketId) }),
        queryClient.invalidateQueries({ queryKey: ticketQueryKey(ticketId) }),
        queryClient.invalidateQueries({ queryKey: TICKETS_KEY }),
      ]),
  });
}

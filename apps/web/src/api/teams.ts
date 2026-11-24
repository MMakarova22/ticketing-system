import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, deleteJson, patchJson, postJson } from "./client.ts";

export interface Team {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  ticketCount: number;
  epicCount: number;
}

export const TEAMS_QUERY_KEY = ["teams"] as const;

/** All teams, ordered by name. */
export function useTeams() {
  return useQuery({
    queryKey: TEAMS_QUERY_KEY,
    queryFn: () => apiFetch<Team[]>("/teams"),
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => postJson<Team>("/teams", { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY }),
  });
}

export function useRenameTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => patchJson<Team>(`/teams/${id}`, { name }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY }),
  });
}

export function useDeleteTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson(`/teams/${id}`),
    // Refresh on failure too: a 409 means the counts on screen were out of date.
    onSettled: (_data, _error, id) => {
      queryClient.removeQueries({ queryKey: ["epics", id] });
      return queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, deleteJson, patchJson, postJson } from "./client.ts";
import { TEAMS_QUERY_KEY } from "./teams.ts";

export interface Epic {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  createdAt: string;
  modifiedAt: string;
  ticketCount: number;
}

export interface EpicFields {
  title: string;
  /** A blank description is stored as null. */
  description: string;
}

export function epicsQueryKey(teamId: string) {
  return ["epics", teamId] as const;
}

/** Epics of one team, ordered by title. Disabled until a team is selected. */
export function useEpics(teamId: string | undefined) {
  return useQuery({
    queryKey: epicsQueryKey(teamId ?? ""),
    queryFn: () => apiFetch<Epic[]>(`/epics?teamId=${encodeURIComponent(teamId ?? "")}`),
    enabled: Boolean(teamId),
  });
}

/** Epic changes also change the team's epic count, so both lists are refreshed. */
function useInvalidateEpics() {
  const queryClient = useQueryClient();
  return (teamId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: epicsQueryKey(teamId) }),
      queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY }),
    ]);
}

export function useCreateEpic() {
  const invalidate = useInvalidateEpics();
  return useMutation({
    mutationFn: ({ teamId, fields }: { teamId: string; fields: EpicFields }) =>
      postJson<Epic>("/epics", { teamId, ...fields }),
    onSettled: (_data, _error, { teamId }) => invalidate(teamId),
  });
}

export function useUpdateEpic() {
  const invalidate = useInvalidateEpics();
  return useMutation({
    mutationFn: ({ epic, fields }: { epic: Epic; fields: EpicFields }) => patchJson<Epic>(`/epics/${epic.id}`, fields),
    onSettled: (_data, _error, { epic }) => invalidate(epic.teamId),
  });
}

export function useDeleteEpic() {
  const invalidate = useInvalidateEpics();
  return useMutation({
    mutationFn: (epic: Epic) => deleteJson(`/epics/${epic.id}`),
    onSettled: (_data, _error, epic) => invalidate(epic.teamId),
  });
}

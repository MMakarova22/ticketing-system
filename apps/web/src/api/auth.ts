import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, postJson } from "./client.ts";

export interface User {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface Credentials {
  email: string;
  password: string;
}

interface MessageResponse {
  message: string;
}

export const ME_QUERY_KEY = ["me"] as const;

/** Error code of POST /api/auth/verify-email for an unknown, used or expired link. */
export const INVALID_OR_EXPIRED_TOKEN = "INVALID_OR_EXPIRED_TOKEN";

/** Password rules of the API (POST /api/auth/verify-email): 8–256 characters, used exactly as typed. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

/** The current user, or null when not logged in (401 is an expected answer here, not an error). */
export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async (): Promise<User | null> => {
      try {
        return await apiFetch<User>("/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

/** Registration takes the email only; the password is chosen on the verification page (review M1). */
export function useRegister() {
  return useMutation({
    mutationFn: (email: string) => postJson<MessageResponse>("/auth/register", { email }),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) => postJson<{ user: User }>("/auth/login", credentials),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(ME_QUERY_KEY, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<void>("/auth/logout"),
    // Even if the server call fails (e.g. session already expired) the user is logged out locally.
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(ME_QUERY_KEY, null);
    },
  });
}

/** Verifies the email and sets the password. Does not log in (no session is created). */
export function useVerifyEmail() {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      postJson<{ verified: true }>("/auth/verify-email", input),
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: (email: string) => postJson<MessageResponse>("/auth/resend-verification", { email }),
  });
}

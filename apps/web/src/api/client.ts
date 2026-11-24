import { parseRetryAfter, tooManyRequestsMessage } from "../lib/retry.ts";

/** Error thrown for any non-2xx API response, carrying the HTTP status and server message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** Seconds from the Retry-After header (sent with 429 responses), if present. */
  readonly retryAfter: number | undefined;

  constructor(status: number, message: string, code?: string, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/**
 * The text to show for a failed request: for a 429 "Too many attempts. Try again in …", built from Retry-After;
 * for anything else the error's own message, unchanged.
 */
export function errorMessage(error: Error): string {
  return error instanceof ApiError && error.status === 429 ? tooManyRequestsMessage(error.retryAfter) : error.message;
}

interface ErrorBody {
  message?: string | string[];
  code?: string;
}

/** POSTs a JSON body (an empty object by default) to an /api path. */
export function postJson<T>(path: string, body: unknown = {}): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

/** PATCHes a JSON body to an /api path. */
export function patchJson<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

/** DELETEs an /api resource. The JSON content type is still sent (the API requires it for every write). */
export function deleteJson<T = void>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

/**
 * Minimal JSON fetch wrapper for the same-origin API under /api.
 * Session cookies are sent automatically (same origin); no tokens are ever put in URLs.
 * Throws ApiError for non-2xx responses and network failures.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  // The API accepts only JSON for every state-changing method (CSRF hardening), even without a body.
  const method = (init.method ?? "GET").toUpperCase();
  if ((init.body !== undefined || (method !== "GET" && method !== "HEAD")) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const err = (body ?? {}) as ErrorBody;
    const message = Array.isArray(err.message) ? err.message.join("; ") : err.message;
    throw new ApiError(
      response.status,
      message ?? `Request failed (HTTP ${response.status})`,
      err.code,
      parseRetryAfter(response.headers.get("Retry-After")),
    );
  }
  return body as T;
}

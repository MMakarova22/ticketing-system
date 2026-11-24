import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { ME_QUERY_KEY } from "./api/auth.ts";
import { ApiError } from "./api/client.ts";
import { router } from "./router.tsx";
import { followSystemTheme } from "./lib/theme.ts";
// Order matters: tokens first, then base, shared components, layout, pages, board (later files may override).
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/pages.css";
import "./styles/board.css";

/** Any 401 means the session is gone (expired or logged out elsewhere): forget the user so routes redirect to login. */
function handleUnauthorized(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    queryClient.setQueryData(ME_QUERY_KEY, null);
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleUnauthorized }),
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Retry once for network/server errors, never for client errors such as 401/403/404.
      retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

// public/theme-init.js already applied the theme before first paint; keep following the OS setting until the user
// saves an explicit choice.
followSystemTheme();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

import { createBrowserRouter } from "react-router";
import { AuthLayout } from "./components/AuthLayout.tsx";
import { Layout } from "./components/Layout.tsx";
import { RedirectIfAuthenticated, RequireAuth } from "./components/RequireAuth.tsx";
import { BoardPage } from "./pages/BoardPage.tsx";
import { EpicsPage } from "./pages/EpicsPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { NewTicketPage } from "./pages/NewTicketPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { ResendVerificationPage } from "./pages/ResendVerificationPage.tsx";
import { SignupPage } from "./pages/SignupPage.tsx";
import { TeamsPage } from "./pages/TeamsPage.tsx";
import { TicketPage } from "./pages/TicketPage.tsx";
import { VerifyEmailPage } from "./pages/VerifyEmailPage.tsx";

export const router = createBrowserRouter([
  {
    // Public screens.
    element: <AuthLayout />,
    children: [
      {
        element: <RedirectIfAuthenticated />,
        children: [
          { path: "login", element: <LoginPage /> },
          { path: "signup", element: <SignupPage /> },
        ],
      },
      { path: "verify-email", element: <VerifyEmailPage /> },
      { path: "resend-verification", element: <ResendVerificationPage /> },
    ],
  },
  {
    // Everything else requires a logged-in, verified user.
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <BoardPage /> },
          { path: "tickets/new", element: <NewTicketPage /> },
          { path: "tickets/:id", element: <TicketPage /> },
          { path: "teams", element: <TeamsPage /> },
          { path: "epics", element: <EpicsPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

import { Outlet } from "react-router";
import { TopNav } from "./layout/TopNav.tsx";

/** Application shell for logged-in users: the top navigation and the current page. */
export function Layout() {
  return (
    <div className="app">
      <TopNav />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

import { Link, NavLink } from "react-router";
import { BrandMark } from "../icons.tsx";
import { AccountMenu } from "./AccountMenu.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

const NAV_ITEMS = [
  { to: "/", label: "Board", end: true },
  { to: "/teams", label: "Teams", end: false },
  { to: "/epics", label: "Epics", end: false },
] as const;

/**
 * Compact top navigation (no sidebar): brand on the left, the three sections, then the theme toggle and the account
 * menu. NavLink sets aria-current="page" on the active section. Below 640 px the brand text and the email are hidden
 * (brand mark and avatar remain), so the bar never overflows horizontally.
 */
export function TopNav() {
  return (
    <header className="topnav">
      {/* Named explicitly: the brand text is hidden on narrow screens. */}
      <Link to="/" className="topnav-brand" aria-label="Ticket Tracker">
        <BrandMark />
        <span className="topnav-brand-text brand-wordmark">Ticket Tracker</span>
      </Link>
      <nav className="topnav-nav" aria-label="Main">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="topnav-link">
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="topnav-actions">
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  );
}

import type { ReactNode } from "react";

/**
 * Small inline SVG icons (no icon library). Decorative: always aria-hidden; the control around them carries the
 * accessible name. They use currentColor, so they follow the text color of the theme.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 16, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25" />
      <path d="M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
    </Svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9.5 4.5-3.5 3.5 3.5 3.5" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.25 3.25" />
    </Svg>
  );
}

/**
 * Brand mark: a ticket stub (two side notches) holding a tiny three-column board. Decorative (aria-hidden, no title):
 * the surrounding link or text carries the name "Ticket Tracker". Colors come from the theme tokens. The geometry is
 * the same as public/favicon.svg (a unit test keeps the two in sync).
 */
export function BrandMark({ size = 22, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="1.5 1.5 21 21"
      aria-hidden="true"
      focusable="false"
      className={className ? `brand-mark ${className}` : "brand-mark"}
    >
      <path
        className="brand-mark-ticket"
        d="M5 4H19A3 3 0 0 1 22 7V9.5A2.5 2.5 0 0 0 22 14.5V17A3 3 0 0 1 19 20H5A3 3 0 0 1 2 17V14.5A2.5 2.5 0 0 0 2 9.5V7A3 3 0 0 1 5 4Z"
        fill="var(--color-accent)"
      />
      <rect className="brand-mark-bar" x="7" y="8" width="2.5" height="8" rx="1" fill="var(--color-on-accent)" />
      <rect className="brand-mark-bar" x="10.75" y="8" width="2.5" height="5.5" rx="1" fill="var(--color-on-accent)" />
      <rect className="brand-mark-bar" x="14.5" y="8" width="2.5" height="3" rx="1" fill="var(--color-on-accent)" />
    </svg>
  );
}

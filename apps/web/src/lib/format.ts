const timeFormat: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Short, human-friendly timestamp in local time: "Today 12:40", "Yesterday 09:15", "Jun 20" or "Jun 20, 2025". */
export function formatModified(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(date, now)) {
    return `Today ${date.toLocaleTimeString(undefined, timeFormat)}`;
  }
  if (isSameDay(date, yesterday)) {
    return `Yesterday ${date.toLocaleTimeString(undefined, timeFormat)}`;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Full local date and time, e.g. for a tooltip. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

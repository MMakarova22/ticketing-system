import { useDroppable } from "@dnd-kit/core";
import { memo } from "react";
import type { Ticket, TicketState } from "../../api/tickets.ts";
import { TicketCard } from "./TicketCard.tsx";

interface BoardColumnProps {
  state: TicketState;
  label: string;
  tickets: Ticket[];
  /** Unfiltered number of tickets in this state. */
  total: number;
  pendingIds: Set<string>;
}

/**
 * One workflow column. The whole column (header included) is a drop target; its id is the state value.
 * The header row and the card list are subgrid rows of the board, so headers line up even when a title wraps.
 */
export const BoardColumn = memo(function BoardColumn({ state, label, tickets, total, pendingIds }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: state });
  const headingId = `column-heading-${state}`;
  const count = tickets.length === total ? String(total) : `${tickets.length} of ${total}`;

  return (
    <section
      ref={setNodeRef}
      className={isOver ? "board-column board-column-over" : "board-column"}
      aria-labelledby={headingId}
      data-testid={`column-${state}`}
      data-state={state}
    >
      <h2 id={headingId} className="board-column-header">
        <span className="board-column-dot" aria-hidden="true" />
        <span className="board-column-title">{label}</span>{" "}
        <span className="board-column-count" data-testid="column-count">
          {count}
        </span>
      </h2>
      {tickets.length === 0 ? (
        <p className="board-column-empty muted">No tickets</p>
      ) : (
        <div className="board-column-cards">
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} saving={pendingIds.has(ticket.id)} />
          ))}
        </div>
      )}
    </section>
  );
});
